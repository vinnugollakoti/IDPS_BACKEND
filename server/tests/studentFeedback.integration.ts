/** Run against a freshly migrated, disposable local feedback_test database only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';

test('feedback and rosters follow live assignments and parent links', async () => {
  const target = new URL(process.env.FEEDBACK_TEST_URL || 'about:blank');
  assert.equal(target.protocol, 'postgresql:');
  assert.equal(target.hostname, 'localhost');
  assert.equal(target.pathname, '/feedback_test');
  assert.ok(target.searchParams.get('host')?.startsWith('/tmp/idps-feedback-check.'));
  process.env.DATABASE_URL = process.env.DIRECT_URL = target.href;
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  const {default: db} = await import('../prisma/client');
  const {default: feedback} = await import('../routes/studentFeedback');
  const {default: roster} = await import('../routes/get');
  const {generateToken} = await import('../middleware/jwt');
  const app = express(); app.use(express.json()); app.use('/get', roster); app.use('/student-feedback', feedback);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const addr = server.address(); assert.ok(addr && typeof addr === 'object');
  const tag = randomUUID();
  const call = (path: string, token: string, message?: string) => fetch('http://127.0.0.1:'+addr.port+path,{
    method:message === undefined?'GET':'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:message === undefined?undefined:JSON.stringify({message}),
  });
  try {
    const teacher = await db.user.create({data:{name:'Test teacher',email:tag+'t@example.invalid',gender:'FEMALE',role:'TEACHER',teacher:{create:{name:'Test teacher',gender:'FEMALE',phone:'test'}}},include:{teacher:true}});
    const parent = await db.user.create({data:{name:'Test guardian',email:tag+'p@example.invalid',gender:'MALE',role:'PARENT',parent:{create:{name:'Test guardian',phone1:'test'}}},include:{parent:true}});
    const tid = teacher.teacher!.id;
    const primary = await db.class.create({data:{name:tag,section:'Primary',teacherId:tid}});
    const secondary = await db.class.create({data:{name:tag,section:'Secondary',teachers:{create:{teacherId:tid}}}});
    const other = await db.class.create({data:{name:tag,section:'Other'}});
    const students = await Promise.all([primary,secondary,other].map(c=>db.student.create({data:{name:'Test student',gender:'FEMALE',classId:c.id}})));
    const [a,b,c] = students;
    const link = {studentId:b.id,parentId:parent.parent!.id};
    await db.parentStudent.create({data:link});
    const staff = generateToken(teacher.id, teacher.role), family = generateToken(parent.id, parent.role);
    const ids = async (path: string) => { const r = await call(path,staff); assert.equal(r.status,200);return (await r.json()).data.map((row:{id:number})=>row.id).sort((a:number,b:number)=>a-b); };
    assert.deepEqual(await ids('/get/get-classes'),[primary.id,secondary.id]);
    assert.deepEqual(await ids('/get/get-students'),[a.id,b.id].sort((x,y)=>x-y));
    // A session can still contain attendance rows for a pupil who has transferred.
    const date = new Date('2026-01-15T00:00:00Z');
    await db.attendanceSession.create({data:{classId:secondary.id,date,createdAt:date,attendances:{
      create:[{studentId:b.id,status:'PRESENT'},{studentId:c.id,status:'PRESENT'}]
    }}});
    for (const token of [staff,family]) {
      const roster = await call('/get/get-classes',token);assert.equal(roster.status,200);
      const row = (await roster.json()).data.find((cls:{id:number})=>cls.id===secondary.id);
      assert.deepEqual(row.attendanceSessions[0].attendances.map((record:{studentId:number})=>record.studentId),[b.id]);
    }
    const path = (id:number)=>'/student-feedback/'+id;
    assert.equal((await call(path(a.id),staff,'A primary-teacher note')).status,201);
    assert.equal((await call(path(b.id),staff,' A secondary-teacher note ')).status,201);
    assert.equal((await call(path(b.id),staff,'   ')).status,400);
    assert.equal((await call(path(b.id),staff,'z'.repeat(2001))).status,400);
    assert.equal((await call(path(c.id),staff,'A note')).status,403);
    assert.equal((await call(path(b.id),family,'A note')).status,403);
    assert.equal((await call(path(a.id),family)).status,403);
    const read = await call(path(b.id),family);assert.equal(read.status,200);
    const result=await read.json();assert.equal(result.data[0].message,'A secondary-teacher note');assert.equal(result.next,null);
    await db.studentFeedback.createMany({data:Array.from({length:20},(_,i)=>({
      studentId:b.id,authorId:teacher.id,authorName:teacher.name,message:'Note '+i
    }))});
    const firstPage = await (await call(path(b.id),family)).json();
    assert.equal(firstPage.data.length,20);assert.equal(firstPage.next,firstPage.data[19].id);
    const lastPage = await (await call(path(b.id)+'?before='+firstPage.next,family)).json();
    assert.deepEqual(lastPage.data.map((n:{id:number})=>n.id),[result.data[0].id]);assert.equal(lastPage.next,null);
    await db.classTeacher.delete({where:{classId_teacherId:{classId:secondary.id,teacherId:tid}}});
    await db.class.update({where:{id:primary.id},data:{teacherId:null}});
    assert.deepEqual(await ids('/get/get-classes'),[]);assert.deepEqual(await ids('/get/get-students'),[]);
    assert.equal((await call(path(b.id),staff,'After reassignment')).status,403);
    await db.parentStudent.delete({where:{parentId_studentId:link}});
    assert.equal((await call(path(b.id),family)).status,403);
    await db.user.update({where:{id:teacher.id},data:{role:'PRINCIPAL'}});
    const formerPrincipal = generateToken(teacher.id,'PRINCIPAL');
    await db.user.update({where:{id:teacher.id},data:{role:'TEACHER'}});
    assert.equal((await call('/get/get-classes',formerPrincipal)).status,401);
  } finally {server.close();await db.$disconnect();}
});
