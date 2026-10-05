/* ตรวจว่า index.html ยังทำงานได้หลัง Google Apps Script ตัด comment ออก
   HtmlService ตัดทุกอย่างที่ «หน้าตาเหมือน comment» ใน <script> โดยไม่ดูว่าอยู่ในข้อความหรือไม่
   ดังนั้นห้ามมี "/" ตามด้วย "*" หรือ "/" สองตัวติดกัน ในข้อความ / template / regex
   ใช้: node tools/gas_strip_check.js [index.html]                                              */
const fs = require("fs");
const file = process.argv[2] || require("path").join(__dirname, "..", "index.html");
const html = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
let bad = 0, n = 0;
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  n++;
  const src = m[1];
  // ตัดแบบเดียวกับ Google: /* ... */ แล้ว // ... ถึงท้ายบรรทัด — ไม่สนว่าอยู่ในข้อความ
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  try { new Function(stripped); console.log(`script ${n}: OK`); }
  catch (e) {
    bad++;
    console.log(`script ${n}: พังหลังตัด comment — ${e.message}`);
    // ชี้ตำแหน่งที่น่าสงสัย: "/*" หรือ "//" ที่อยู่หลังเครื่องหมายคำพูดในบรรทัดเดียวกัน
    src.split("\n").forEach((l, i) => {
      const k = l.search(/\/\*|\/\//); if (k < 0) return;
      const before = l.slice(0, k);
      const q = (before.match(/"/g) || []).length % 2 || (before.match(/'/g) || []).length % 2 || (before.match(/`/g) || []).length % 2;
      if (q || /=\s*$|\(\s*$/.test(before) && /\/\//.test(l.slice(k, k + 2)) === false)
        console.log(`  บรรทัด ${i + 1}: ${l.trim().slice(0, 140)}`);
    });
  }
}
process.exit(bad ? 1 : 0);
