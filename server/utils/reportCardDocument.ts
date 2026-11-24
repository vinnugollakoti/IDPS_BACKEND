import { readFileSync } from "node:fs";
import { join } from "node:path";

const crest = readFileSync(join(__dirname, "../assets/report-card-crest.jpg")).toString("base64");
type Mark = { subject: { name:string }; totalMarks:number; marks:{marks:number}[] };
type Student = {name:string; class:{name:string;section:string}; height?:number|null; weight?:number|null};
const escape = (value:unknown) => String(value ?? "").replace(/[\p{Extended_Pictographic}\uFE0F]/gu,"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const key = (s:string) => s.toLowerCase().replace(/\(.*?\)/g,"").replace(/[^a-z]/g,"").replace(/^maths?$/,"mathematics").replace("environmentalstudies","evs").replace("socialstudies","socialscience");
const grade = (n:number) => ["A1","A2","B1","B2","C1","C2","D","E"][[90,80,70,60,50,40,32,-1].findIndex(v=>n>v)];
const rounded = (n:number) => Number(n.toFixed(2));
const table = (headers:string[], rows:unknown[][]) => '<table>'+ (headers.length?'<thead><tr>'+headers.map(v=>'<th>'+escape(v)+'</th>').join('')+'</tr></thead>':'')+'<tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';

export function reportCardDocument(student:Student, name:string, date:Date, exams:Mark[], stored:unknown) {
  const f = (stored || {}) as Record<string,string>;
  const upper = /(?:^|[^a-z0-9])(?:[678](?:th)?|VI|VII|VIII)(?![a-z0-9])/i.test(student.class.name);
  const subjects = ["English","Telugu","Hindi","Mathematics",...(upper?["Science","Social Science"]:["E.V.S"])];
  const labels:Record<string,string> = {Telugu:"Telugu (Second language)",Hindi:"Hindi (Third language)"};
  const sums:number[]=[];
  let absent=false;
  const rows=subjects.map(s=>{
    const marks=exams.find(e=>key(e.subject.name)===key(s));
    const internal=["PA","MA","Portfolio","SEA"].map(k=>f[s+" "+k] || null);
    const written=marks?.totalMarks===80 ? marks.marks[0]?.marks ?? f[s+" Written"] : f[s+" Written"];
    const values=[...internal,written];
    const abs=String(written).toLowerCase()==="abs";
    absent ||= abs;
    const total=values.every(v=>v!=null && v!=="" && Number.isFinite(Number(v)))?rounded(values.reduce<number>((a,b)=>a+Number(b),0)):null;
    if(total!=null)sums.push(total);
    return [labels[s]||s,...internal,written || (written===0?0:null),abs?"Abs":total,abs?"Abs":total!=null?grade(total):null];
  });
  const complete=sums.length===subjects.length;
  const sum=rounded(sums.reduce((a,b)=>a+b,0));
  const pct=rounded(sum/subjects.length);
  const extra=exams.filter(e=>e.marks.length && (e.totalMarks!==80 || !subjects.some(s=>key(s)===key(e.subject.name))));
  const year=date.getUTCFullYear()-(date.getUTCMonth()<3?1:0);
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>
  *{box-sizing:border-box}body{margin:0;padding:8px;color:#171d16;background:white;font:14px Georgia,serif}article{max-width:820px;margin:auto;padding:12px;border:2px solid #283224}header{text-align:center;display:flex;align-items:center;justify-content:center;gap:10px}img{width:56px}h1{font-size:20px;margin:0}h2,h3{text-align:center;font-size:16px;margin:12px 0 6px}small{font-size:11px}table{width:100%;border-collapse:collapse;margin:5px 0;text-align:center}th,td{border:1px solid #424a40;padding:5px;overflow-wrap:anywhere}th{background:#a8d08d;color:#153823}td{height:26px}h3{background:#e4efdc;border-left:4px solid #508652;color:#214829;padding:6px}h3:before{content:"";display:inline-block;width:6px;height:6px;background:#508652;border-radius:50%;margin:0 7px 2px 0}.grades{display:flex;flex-wrap:wrap;gap:9px;list-style:none;padding:0}.grades li{display:flex;align-items:center;gap:4px}.box{display:inline-block;width:12px;height:12px;border:1px solid #416547}.marked{background:#416547;box-shadow:inset 0 0 0 2px white}section{overflow-x:auto}.marks{min-width:580px}footer{display:flex;justify-content:space-between;margin:24px 0 12px;text-align:center}footer span{border-top:1px solid;padding:4px}p{overflow-wrap:anywhere}@media print{article{border:0}body{padding:0}section{overflow:visible}table{break-inside:avoid}}</style></head><body><article>
  <header><img alt="IDPS crest" src="data:image/jpeg;base64,${crest}"><div><h1>INTERNATIONAL DELHI PUBLIC SCHOOL-KOVVUR</h1><small>(Under The Aegis of The International Delhi Public School Society, New Delhi)</small></div></header>
  <h2>${escape(name.toUpperCase())} REPORT CARD<br>(SESSION: ${year}-${String(year+1).slice(-2)})</h2>
  <p><b>STUDENT NAME:</b> ${escape(student.name)}</p>${table(["Roll no.","Grade","Section"],[[f["Roll number"],student.class.name,student.class.section]])}
  <h3>PART 1 · SCHOLASTIC AREA</h3><section><div class="marks">${table(["Subject","P.A (5)","M.A (5)","Portfolio (5)","S.E.A (5)","Examination (80)","Total (100)","Subject grade"],rows)}</div></section>
  ${extra.length?table(["Recorded exam subject","Marks obtained","Maximum marks"],extra.map(e=>[e.subject.name,e.marks[0].marks,e.totalMarks])):""}
  ${table(["GK","Computer","Reasoning"],[[f.GK,f.Computer,f.Reasoning]])}
  ${table(["Total marks","Overall percentage","Overall grade"],[[complete?sum:absent?"Abs":null,complete?pct+"%":absent?"Abs":null,complete?grade(pct):absent?"Abs":null]])}
  <h3>PART 2 · CO-SCHOLASTIC AREA ACTIVITIES</h3>
  ${table(["Activity","Art education","Health & physical education","Discipline"],[["Grade",f["Art education"],f["Health and physical education"],f.Discipline]])}
  ${table([],[["Total no. of working days",f["Working days"]],["No. of days attended",f["Days attended"]],["Percentage",Number(f["Working days"])>0 && f["Days attended"]?rounded(100*Number(f["Days attended"])/Number(f["Working days"]))+"%":null],["Height (cm)",f["Height (cm)"]||student.height],["Weight (kg)",f["Weight (kg)"]||student.weight]])}
  ${table([], [["Activity 1",f["Activity 1"],"Activity 2",f["Activity 2"]],["Grade",f["Activity 1 grade"],"Grade",f["Activity 2 grade"]]])}
  <p>Remarks: ${escape(f.Remarks)}</p><footer>${["Date","Class teacher","Principal"].map(k=>'<span>'+escape(f[k])+'<br>'+k+'</span>').join('')}</footer>
  <h3>GRADING SYSTEM</h3><ul class="grades" aria-label="Overall scholastic grade">${["A1","A2","B1","B2","C1","C2","D","E"].map(g=>'<li><span role="checkbox" aria-readonly="true" aria-checked="'+(complete && grade(pct)===g)+'" class="box '+(complete && grade(pct)===g?'marked':'')+'"></span>'+g+'</li>').join('')}</ul><small>Scholastic areas (8-point scale)</small>${table(["Grade","A1","A2","B1","B2","C1","C2","D","E"],[["Marks range","91–100","81–90","71–80","61–70","51–60","41–50","33–40","0–32"]])}
  <small>Co-scholastic activities (5-point scale)</small>${table(["Grade","A","B","C","D","E"],[["Grade points",5,4,3,2,1]])}</article></body></html>`;
}
