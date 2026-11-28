import type { Response } from 'express';
import type { Prisma } from '../generated/prisma/client';
import type { AuthRequest } from '../middleware/auth';
import { isExecutiveRole } from '../middleware/auth';
import db from '../prisma/client';
import { serverCache } from '../utils/cache';
import { assignedClasses } from './teacherClassScope';

class Problem extends Error { constructor(readonly status: number, message: string) { super(message); } }
const bad = (message: string): never => { throw new Problem(400, message); };
function stringField(raw: unknown, label: string, max: number, required = false) {
  if (raw !== null && typeof raw !== 'string') return bad('Invalid '+label);
  const value = raw?.trim() || null;
  if ((required && !value) || (value && value.length > max)) return bad('Check '+label);
  return value;
}
function positive(raw: unknown, name: string) {
  if ((typeof raw !== 'number' && typeof raw !== 'string') || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw)<1) return bad('Invalid '+name);
  return Number(raw);
}
function date(raw: unknown, label: string) {
  if (raw === '' || raw === null) return null;
  const day = typeof raw === 'string' && /^(\d{4}-\d\d-\d\d)(?:T00:00:00(?:\.000)?Z)?$/.exec(raw)?.[1];
  if (!day) return bad('Use YYYY-MM-DD for '+label);
  const d = new Date(day+'T00:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0,10)!==day) return bad('Invalid '+label);
  return d;
}
function choice<T extends string>(raw: unknown, allowed: readonly T[], aliases: Record<string,string> = {}): T | null {
  if (raw === '' || raw === null) return null;
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  const normalized = aliases[value] ?? value;
  if (!allowed.includes(normalized as T)) return bad('Invalid selection: '+value.slice(0,30));
  return normalized as T;
}
function phone(raw: unknown, required: boolean) {
  const value = stringField(raw,'phone number',24,required);
  if (value && !/^\+?[\d ()-]+$/.test(value) || value && !/^\d{7,15}$/.test(value.replace(/\D/g,''))) return bad('Enter a valid phone number');
  return value;
}
export async function updateStudentProfile(req: AuthRequest, res: Response) {
  const teacher = req.user.role === 'TEACHER';
  if (!teacher && !isExecutiveRole(req.user.role) && req.user.role !== 'RECEPTIONIST') return res.sendStatus(403);
  try {
    const id = positive(req.params.id,'student id');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Invalid student details');
    const scope = assignedClasses(Number(req.user.userId));
    const data: Prisma.StudentUncheckedUpdateInput = {};
    if ('name' in body) data.name=stringField(body.name,'student name',200,true)!;
    if ('gender' in body) data.gender=choice(body.gender,['MALE','FEMALE'] as const) ?? bad('Choose a gender');
    if ('classId' in body) data.classId=positive(body.classId,'class');
    if ('busId' in body) data.busId=body.busId===null || body.busId==='' ? null : positive(body.busId,'bus');
    if ('dob' in body) data.dob=date(body.dob,'date of birth');
    if ('admissiondate' in body) data.admissiondate=date(body.admissiondate,'admission date');
    if ('address' in body) data.address=stringField(body.address,'address',2000);
    if ('pincode' in body) {data.pincode=stringField(body.pincode,'PIN code',6); if(data.pincode && !/^\d{6}$/.test(data.pincode)) return bad('Enter a six-digit PIN code');}
    if ('admissionno' in body) data.admissionno=stringField(body.admissionno,'admission number',80,true)!;
    if ('photo' in body) {data.photo=stringField(body.photo,'photo URL',4096); if(data.photo && !/^https?:\/\//i.test(data.photo)) return bad('Use a valid photo URL');}
    if ('adharnumber' in body) {
      if(teacher) throw new Problem(403,'Aadhaar is restricted to office staff');
      data.adharnumber=stringField(body.adharnumber,'Aadhaar',12);
      if(data.adharnumber && !/^\d{12}$/.test(data.adharnumber)) return bad('Enter a 12-digit Aadhaar number');
    }
    if ('mothertongue' in body) data.mothertongue=choice(body.mothertongue,['TELUGU','URGU','ENGLISH'] as const,{URDU:'URGU'});
    if ('bloodgroup' in body) data.bloodgroup=choice(body.bloodgroup,['A_POS','A_NEG','B_POS','B_NEG','AB_POS','AB_NEG','O_POS','O_NEG'] as const,Object.fromEntries(['A','B','AB','O'].flatMap(g=>[[g+'+',g+'_POS'],[g+'-',g+'_NEG']])));
    if ('socialcategory' in body) data.socialcategory=choice(typeof body.socialcategory==='string'?body.socialcategory.replace(/[ -]/g,'_'):body.socialcategory,['OC','BC_A','BC_B','BC_C','BC_D','BC_E','MBC_DNC','SC','ST'] as const,{GENERAL:'OC'});
    for (const k of ['height','weight'] as const) if(k in body) {
      const v = body[k];
      if(v!==null && v!=='' && ((typeof v!=='number' && typeof v!=='string') || !Number.isFinite(Number(v)) || Number(v)<=0)) return bad('Enter a positive '+k);
      data[k]=v===null || v==='' ? null : Number(v);
    }
    const contacts = body.guardians ?? [];
    if (!Array.isArray(contacts) || contacts.length>20) return bad('Invalid guardian list');
    if (!Object.keys(data).length && !contacts.length) return bad('No changes to save');
    const student = await db.$transaction(async tx=>{
      const current=await tx.student.findFirst({where:{id,...(teacher?{class:scope}:{})},select:{updatedAt:true}});
      if(!current) throw new Problem(teacher?403:404,'Student is unavailable');
      if (body.expectedUpdatedAt && current.updatedAt.toISOString()!==body.expectedUpdatedAt) throw new Problem(409,'This student was edited elsewhere. Reopen the profile before saving.');
      if (typeof data.classId==='number' && !await tx.class.findFirst({where:{id:data.classId,...(teacher?scope:{})},select:{id:true}})) throw new Problem(teacher?403:400,'Selected class is unavailable');
      if (typeof data.busId==='number' && !await tx.bus.findUnique({where:{id:data.busId},select:{id:true}})) return bad('Selected bus is unavailable');
      for (const contact of contacts) {
        if(!contact || typeof contact!=='object') return bad('Invalid guardian');
        const parentId=positive(contact.id,'guardian');
        const parent=await tx.parent.findFirst({where:{id:parentId,students:{some:{studentId:id},...(teacher?{none:{student:{class:{NOT:scope}}}}:{})}},select:{userId:true,updatedAt:true}});
        if(!parent) throw new Problem(403,'This guardian contact must be updated by the school office.');
        if(contact.expectedUpdatedAt && parent.updatedAt.toISOString()!==contact.expectedUpdatedAt) throw new Problem(409,'A guardian contact changed. Reopen the profile before saving.');
        const patch: Prisma.ParentUpdateInput={};
        if('name' in contact) patch.name=stringField(contact.name,'guardian name',200,true)!;
        if('phone1' in contact) patch.phone1=phone(contact.phone1,true)!;
        if('phone2' in contact) patch.phone2=phone(contact.phone2,false);
        if(!Object.keys(patch).length) return bad('No changes to guardian contact');
        await tx.parent.update({where:{id:parentId},data:patch});
        if(typeof patch.name==='string') await tx.user.update({where:{id:parent.userId},data:{name:patch.name}});
      }
      return tx.student.update({where:{id},data:{...data,updatedAt:new Date()},omit:{adharnumber:teacher},include:{
        class:true,bus:true,parents:{include:{parent:{omit:{adharnumber:teacher},include:{
          user:{select:{email:true,gender:true}},_count:{select:{students:{where:{student:{class:{NOT:scope}}}}}}
        }}}}
      }});
    },{isolationLevel:'Serializable'});
    serverCache.clear();
    return res.json({message:'Student details saved',data:student});
  } catch(e:any) {
    if(e instanceof Problem) return res.status(e.status).json({message:e.message});
    if(e?.code==='P2034') return res.status(409).json({message:'Another change was saved at the same time. Reopen the profile and try again.'});
    return res.status(500).json({message:'Unable to save the student profile'});
  }
}
