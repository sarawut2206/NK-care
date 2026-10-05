/**
 * กบข.นข. — ระบบทะเบียนสัญญาและรับชำระ
 * Code.gs — ฝั่งเซิร์ฟเวอร์บน Google Apps Script
 *
 * ทำ 3 อย่าง
 *   1. เสิร์ฟหน้าโปรแกรม (index.html) ให้เปิดจากลิงก์ /exec ได้เลย
 *   2. เก็บและอ่านข้อมูลจาก Google Sheets — เก็บทั้งก้อนเป็น JSON จึงไม่มีฟิลด์ไหนหล่นหาย
 *      แล้วแตกออกเป็นชีทอ่านง่ายให้กรรมการดูได้ (สั่งจากเมนู)
 *   3. ให้ Claude อ่านสลิป/สเตทเมนท์ที่เป็นรูปภาพหรือ PDF แล้วแปลงเป็นรายการรับโอน
 *
 * ── ติดตั้งครั้งแรก ────────────────────────────────────────────────
 *   1. เปิด Google Sheet ที่จะใช้เก็บข้อมูล → เมนู ส่วนขยาย → Apps Script
 *   2. วางไฟล์นี้ทับ Code.gs   แล้วสร้างไฟล์ HTML ชื่อ index วางเนื้อ index.html ลงไป
 *   3. ตั้งค่ารหัสและกุญแจ (ทำครั้งเดียว) — เมนู กบข.นข. → ตั้งค่ารหัสเชื่อมต่อ / ตั้งค่ากุญแจ AI
 *      หรือใส่ที่ ตั้งค่าโปรเจกต์ → Script properties  ชื่อ REMOTE_TOKEN และ AI_KEY
 *   4. Deploy → New deployment → Web app
 *        Execute as        : Me
 *        Who has access    : Anyone            ← ต้องเป็น Anyone หน้าเว็บภายนอกจึงจะเรียกได้
 *   5. ทุกครั้งที่แก้ไฟล์นี้ ต้อง Deploy → Manage deployments → ✏️ → New version → Deploy
 *
 * ── ความปลอดภัย ──────────────────────────────────────────────────
 *   ลิงก์ /exec เปิดให้ใครก็เรียกได้ตามการตั้งค่าข้อ 4  ตัวกันคือ REMOTE_TOKEN
 *   ทุกคำขอที่เข้ามาทาง doPost ต้องแนบรหัสนี้ ไม่ตรง = ปฏิเสธ
 *   จึงห้ามเอา REMOTE_TOKEN ไปใส่ในไฟล์ที่เปิดสาธารณะ เช่น GitHub
 */

/* ============ ตั้งค่า ============ */
var SHEET_DATA   = "_ข้อมูล";           // ชีทเก็บ JSON ก้อนใหญ่ (ซ่อนไว้ ห้ามลบ ห้ามแก้มือ)
var CHUNK        = 40000;               // ตัด JSON เป็นท่อน ๆ ละ 4 หมื่นตัวอักษร (ช่องละไม่เกิน 5 หมื่น)
var AI_MODEL     = "claude-opus-5";
var AI_DAILY_MAX = 40;                  // เรียก AI ได้วันละกี่ครั้ง กันเผลอกดรัว
var TZ           = "Asia/Bangkok";

function prop_(k){ return PropertiesService.getScriptProperties().getProperty(k) || ""; }
function setProp_(k, v){ PropertiesService.getScriptProperties().setProperty(k, v); }
function token_(){ return prop_("REMOTE_TOKEN"); }
function aiKey_(){ return prop_("AI_KEY"); }

/* ============ 1) เสิร์ฟหน้าโปรแกรม ============ */
var PAGES_URL = "https://sarawut2206.github.io/NK-care/";   // ที่เปิดสำรอง ถ้ายังไม่ได้วางไฟล์ index

function doGet(e){
  var TITLE = "กบข.นข. — ระบบทะเบียนสัญญาและรับชำระ", why = [];
  // 1) ดึงโปรแกรมล่าสุดจาก GitHub Pages — push เมื่อไหร่ ลิงก์ /exec ได้ของใหม่ทันที ไม่ต้องวางไฟล์ index เอง
  try{
    var r = UrlFetchApp.fetch(PAGES_URL + "index.html?t=" + Date.now(), {muteHttpExceptions:true, followRedirects:true});
    var t = r.getResponseCode() === 200 ? r.getContentText("UTF-8") : "";
    if(t.indexOf("google.script") >= 0)
      return HtmlService.createHtmlOutput(t).setTitle(TITLE).addMetaTag("viewport", "width=device-width, initial-scale=1");
    why.push("GitHub Pages ตอบ " + r.getResponseCode());
  }catch(err){ why.push("ดึงจาก GitHub Pages ไม่ได้: " + (err && err.message || err)); }
  // 2) สำรอง: ไฟล์ HTML ชื่อ index ในโปรเจกต์ (ถ้ามี)
  try{
    return HtmlService.createHtmlOutputFromFile("index").setTitle(TITLE)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }catch(err){
    why.push(String(err && err.message || err));
    // ทั้งสองทางไม่ได้ — บอกวิธีทำ ดีกว่าโยน error เปล่า ๆ ใส่หน้าผู้ใช้
    return HtmlService.createHtmlOutput(setupPage_(why.join(" · ")))
      .setTitle("กบข.นข. — ยังตั้งค่าไม่ครบ")
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
}

function setupPage_(msg){
  return '<!doctype html><meta charset="utf-8">'
    + '<style>body{font-family:"IBM Plex Sans Thai",system-ui,sans-serif;background:#F4F7FC;color:#0B2C6B;'
    + 'margin:0;padding:26px 18px;line-height:1.65}'
    + '.w{max-width:640px;margin:0 auto;background:#fff;border:1px solid #D3DEEF;border-radius:12px;padding:22px 24px}'
    + 'h1{font-size:19px;margin:0 0 4px}p{margin:8px 0}ol{margin:8px 0 8px 20px}li{margin-bottom:7px}'
    + 'code{background:#EAF1FB;padding:1px 6px;border-radius:5px;font-family:ui-monospace,monospace;font-size:13px}'
    + 'b{color:#0B2C6B}.e{background:#FDF3F3;border-left:4px solid #C0202E;padding:8px 11px;border-radius:0 6px 6px 0;'
    + 'font-size:13px;color:#8A1B24;margin:12px 0}'
    + 'a.btn{display:inline-block;background:#0B2C6B;color:#fff;text-decoration:none;padding:9px 16px;'
    + 'border-radius:9px;font-weight:600;margin-top:6px}</style>'
    + '<div class="w"><h1>ยังวางไฟล์หน้าโปรแกรมไม่ครบ</h1>'
    + '<p>ตัวเซิร์ฟเวอร์ทำงานได้แล้ว แต่ยังหา<b>ไฟล์ HTML ชื่อ index</b> ในโปรเจกต์ Apps Script ไม่เจอ</p>'
    + '<div class="e">' + msg + '</div>'
    + '<p><b>วิธีทำ</b></p><ol>'
    + '<li>ในหน้า Apps Script กด <b>+</b> ข้างคำว่า «ไฟล์» → เลือก <b>HTML</b></li>'
    + '<li>ตั้งชื่อว่า <code>index</code> (พิมพ์แค่นี้ ระบบเติม .html ให้เอง)</li>'
    + '<li>ลบข้อความตัวอย่างในไฟล์ให้หมด แล้ววางเนื้อ <code>index.html</code> ของโปรแกรมลงไปทั้งไฟล์</li>'
    + '<li>กด <b>บันทึก</b> แล้ว <b>การทำให้ใช้งานได้ → จัดการ → ✏️ → เวอร์ชันใหม่ → ทำให้ใช้งานได้</b></li>'
    + '<li>เปิดลิงก์นี้อีกครั้ง</li></ol>'
    + '<p>ระหว่างนี้เปิดโปรแกรมจากที่นี่ไปก่อนได้ แล้วกด «ต่อจากหน้านี้ ใช้รหัสเชื่อมต่อ»</p>'
    + '<a class="btn" href="' + PAGES_URL + '" target="_blank" rel="noopener">เปิดโปรแกรมจาก GitHub Pages</a>'
    + '</div>';
}

/* ============ 2) ทางเข้าสำหรับหน้าเว็บภายนอก (GitHub Pages / เปิดไฟล์ตรง) ============ */
function doPost(e){
  var out;
  try{
    var req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var want = token_();
    if(!want)                       throw new Error("ยังไม่ได้ตั้ง REMOTE_TOKEN ใน Apps Script — เมนู กบข.นข. → ตั้งค่ารหัสเชื่อมต่อ");
    if(String(req.token) !== want)  throw new Error("รหัสเชื่อมต่อไม่ถูกต้อง");

    switch(req.action){
      case "getData":   out = readAll_();                       break;
      case "saveState": out = {ok:true, saved: writeAll_(req.payload)}; break;
      case "ai":        out = JSON.parse(ai(req.payload));       break;
      case "aiSchedule": out = JSON.parse(aiSchedule(req.payload)); break;
      case "ping":      out = {ok:true, ai: !!aiKey_(), time: now_()}; break;
      default: throw new Error("ไม่รู้จักคำสั่ง: " + req.action);
    }
  }catch(err){
    out = {error: String((err && err.message) || err)};
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ 3) ฟังก์ชันที่หน้าเว็บเรียกตรง (ตอนเปิดจากลิงก์ /exec) ============ */
function getData(){ return JSON.stringify(readAll_()); }          // ต้องคืนเป็นข้อความ
function saveState(payload){ return JSON.stringify({ok:true, saved: writeAll_(payload)}); }

/* ============ เก็บ/อ่านข้อมูล ============ */
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }

function dataSheet_(create){
  var sh = ss_().getSheetByName(SHEET_DATA);
  if(!sh && create){
    sh = ss_().insertSheet(SHEET_DATA);
    sh.getRange("A1").setNote("ข้อมูลทั้งหมดของโปรแกรม เก็บเป็น JSON — อย่าแก้ด้วยมือ");
    sh.hideSheet();
  }
  return sh;
}

/* อ่าน JSON ก้อนใหญ่ตามที่เก็บไว้ — รูปแบบเดียวกับไฟล์สำรองที่ปุ่ม «นำเข้า» ของโปรแกรมอ่านได้ */
function readPacked_(){
  var sh = dataSheet_(false);
  if(!sh) return {};
  var v = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 1).getValues();
  var txt = v.map(function(r){ return r[0] || ""; }).join("");
  if(!txt) return {};
  try{ return JSON.parse(txt); }
  catch(err){ throw new Error("ข้อมูลในชีท " + SHEET_DATA + " เสียหาย อ่านไม่ออก — กู้จากไฟล์สำรองใน Drive"); }
}

/* แยกเป็น db / state / board ตามที่หน้าเว็บต้องการ */
function readAll_(){
  var packed = readPacked_();
  return {
    db: {
      members: packed.members || [],
      anames:  packed.anames  || {},
      wd:      packed.wd      || []
    },
    state: {
      contracts: packed.contracts || [],
      tx:        packed.tx        || [],
      acct:      packed.acct      || {},
      assign:    packed.assign    || {},
      profile:   packed.profile   || {},
      per:       packed.per       || {},
      rule:      packed.rule      || {},
      cut:       packed.cut       || 20,
      pdfg:      packed.pdfg      || {},
      ledger:    packed.ledger    || [],         // สมุดรับชำระที่กรรมการกรอกเอง
      open:      packed.open      || null,       // ข้อมูลการนำเข้ายอดยกมา
      nw:        packed.nw        || null        // เว็บใหม่: ทะเบียนผู้กู้ / ผู้ฝาก
    },
    board: packed.board || {},
    user:  userLabel_(),
    time:  now_()
  };
}

/* เขียนทับทั้งก้อน — ล็อกกันสองคนบันทึกชนกัน */
function writeAll_(payload){
  var obj = (typeof payload === "string") ? JSON.parse(payload) : payload;
  if(!obj || typeof obj !== "object") throw new Error("ข้อมูลที่ส่งมาไม่ถูกรูปแบบ");

  var lock = LockService.getScriptLock();
  if(!lock.tryLock(20000)) throw new Error("มีคนกำลังบันทึกอยู่ ลองใหม่อีกครั้ง");
  try{
    var txt = JSON.stringify(obj);
    var sh  = dataSheet_(true);
    sh.clearContents();
    var rows = [], i;
    for(i = 0; i < txt.length; i += CHUNK) rows.push([txt.substr(i, CHUNK)]);
    if(!rows.length) rows = [[""]];
    sh.getRange(1, 1, rows.length, 1).setValues(rows);
    stamp_(obj, txt.length);
    autoBuild_();
    return txt.length;
  } finally { lock.releaseLock(); }
}

/* บันทึกร่องรอยการบันทึกไว้ดูย้อนหลัง */
function stamp_(obj, size){
  var name = "บันทึกล่าสุด";
  var sh = ss_().getSheetByName(name) || ss_().insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 6, 2).setValues([
    ["บันทึกเมื่อ",   now_()],
    ["โดย",           userLabel_()],
    ["สมาชิก",        (obj.members   || []).length],
    ["สัญญา",         (obj.contracts || []).length],
    ["รายการรับชำระ", (obj.tx        || []).length],
    ["ขนาดข้อมูล",    size + " ตัวอักษร"]
  ]);
  sh.getRange(1, 1, 6, 1).setFontWeight("bold");
  sh.autoResizeColumns(1, 2);
}

function now_(){ return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm:ss"); }
function userLabel_(){
  try{ return Session.getActiveUser().getEmail() || "ผ่านลิงก์"; }
  catch(err){ return "ผ่านลิงก์"; }
}

/* ============ ชีทอ่านง่าย — สร้างจากข้อมูลล่าสุด (สั่งจากเมนู) ============ */
function buildSheets(){
  var d = readAll_(), db = d.db, st = d.state;
  var mName = {};
  (db.members || []).forEach(function(m){ mName[m.no] = m.name || ""; });

  sheetOut_("สมาชิก",
    ["เลขสมาชิก","ชื่อ-สกุล","ทุนเรือนหุ้นยกมา","เลขบัตรประชาชน","ตำแหน่ง","โทร","ที่อยู่"],
    (db.members || []).map(function(m){
      var p = (st.profile || {})[m.no] || {};
      return [m.no, m.name || "", m.share || 0, p.cid || "", p.pos || "", p.tel || "", p.addr || ""];
    }));

  sheetOut_("บัญชีธนาคาร",
    ["บัญชีท้าย 4 หลัก","ชื่อในสเตทเมนท์","เลขสมาชิก","ชื่อสมาชิก"],
    Object.keys(db.anames || {}).sort().map(function(a){
      var no = (st.acct || {})[a] || "";
      return [a, db.anames[a], no, mName[no] || ""];
    }));

  sheetOut_("สัญญา",
    ["รหัสสัญญา","เลขทะเบียน","ผลิตภัณฑ์","เลขสมาชิก","ชื่อสมาชิก","วันที่ทำสัญญา","ชำระงวดแรก",
     "วงเงิน","จำนวนงวด","งวดละ","หุ้นประจำ","วิธีคิดหุ้น","ผู้ค้ำ 1","ผู้ค้ำ 2","สัญญาเก่า","ชำระแล้ว (งวด)","หนี้ยกมา ธ.ค.68"],
    (st.contracts || []).map(function(c){
      return [c.id, c.code || "", c.prod || "", c.no || "", mName[c.no] || "", c.d || "", c.p1 || "",
              c.amt || 0, c.terms || 0, c.inst || 0, c.shareM || 0, c.mode || "",
              c.g1 || "", c.g2 || "", c.legacy ? "ใช่" : "", c.t0 || 0, has_(c.bal0) ? +c.bal0 : ""];
    }));

  sheetOut_("เงินโอนจากสเตทเมนท์",
    ["วันที่","เวลา","บัญชีท้าย 4 หลัก","ชื่อในสเตทเมนท์","ยอดเงิน","เลขสมาชิก","ชื่อสมาชิก","ที่มา","หมายเหตุ"],
    (st.tx || []).slice().sort(function(a, b){ return (a.d || "") < (b.d || "") ? -1 : 1; }).map(function(t){
      var no = t.fixNo || t.no || (st.acct || {})[t.a] || "";
      return [t.d || "", t.t || "", t.a || "", (db.anames || {})[t.a] || "", t.m || 0,
              no, mName[no] || "", t.man ? "บันทึกมือ" : "สเตทเมนท์", t.note || t.part || ""];
    }));

  // ---- สมุดรับชำระ (กรอกเอง) ----
  var cMap = {};
  (st.contracts || []).forEach(function(c){ cMap[c.id] = c; });
  var L = (st.ledger || []).slice().sort(function(a, b){
    return a.p < b.p ? -1 : a.p > b.p ? 1 : (String(a.no) < String(b.no) ? -1 : 1); });

  sheetOut_("สมุดรับชำระ",
    ["งวด","เลขสมาชิก","ชื่อสมาชิก","สัญญา","วันที่รับ","ยอดรับ","ดอกเบี้ย","เงินต้น","หุ้นประจำ","หุ้นเพิ่ม",
     "ค่าทวงถาม","หนี้คงเหลือ","ยอดรับ − ยอดแยก","ผ่อนผัน","หมายเหตุ"],
    L.map(function(e){
      var c = cMap[e.cid];
      var parts = n_(e.int) + n_(e.pri) + n_(e.shB) + n_(e.shE) + n_(e.fee);
      return [perLabel_(e.p), e.no, mName[e.no] || "",
              (c && c.prod !== "ฝากหุ้น") ? c.prod + (c.code ? " · " + c.code : "") : "ฝากหุ้น",
              e.d || "", n_(e.m), n_(e.int), n_(e.pri), n_(e.shB), n_(e.shE), n_(e.fee),
              has_(e.bal) ? +e.bal : "", r2_(n_(e.m) - parts), e.relief ? "ใช่" : "", e.note || ""];
    }));

  var pm = {}, lastBal = {};
  L.forEach(function(e){
    var a = pm[e.no] = pm[e.no] || {n:{}, m:0, int:0, pri:0, sh:0, fee:0};
    a.n[e.p] = 1; a.m += n_(e.m); a.int += n_(e.int); a.pri += n_(e.pri);
    a.sh += n_(e.shB) + n_(e.shE); a.fee += n_(e.fee);
    if(e.cid && has_(e.bal)) lastBal[e.cid] = +e.bal;          // เรียงตามงวดแล้ว ตัวท้ายคือล่าสุด
  });
  sheetOut_("สรุปรายคน",
    ["เลขสมาชิก","ชื่อสมาชิก","งวดที่บันทึก","รับรวม","ดอกเบี้ย","เงินต้น","หุ้นที่ฝาก","ค่าทวงถาม",
     "ทุนเรือนหุ้นยกมา","ทุนเรือนหุ้นสะสม","หนี้คงเหลือล่าสุด"],
    (db.members || []).map(function(m){
      var a = pm[m.no] || {n:{}, m:0, int:0, pri:0, sh:0, fee:0}, debt = 0, any = false;
      (st.contracts || []).forEach(function(c){
        if(c.no === m.no && lastBal[c.id] != null){ debt += lastBal[c.id]; any = true; } });
      return [m.no, m.name || "", Object.keys(a.n).length, r2_(a.m), r2_(a.int), r2_(a.pri), r2_(a.sh), r2_(a.fee),
              n_(m.share), r2_(n_(m.share) + a.sh), any ? r2_(debt) : ""];
    }));

  var pp = {};
  L.forEach(function(e){
    var a = pp[e.p] = pp[e.p] || {n:0, m:0, int:0, pri:0, shB:0, shE:0, fee:0};
    a.n++; a.m += n_(e.m); a.int += n_(e.int); a.pri += n_(e.pri);
    a.shB += n_(e.shB); a.shE += n_(e.shE); a.fee += n_(e.fee);
  });
  sheetOut_("สรุปรายงวด",
    ["งวด","จำนวนรายการ","รับรวม","ดอกเบี้ย","เงินต้น","หุ้นประจำ","หุ้นเพิ่ม","ค่าทวงถาม"],
    Object.keys(pp).sort().map(function(k){ var a = pp[k];
      return [perLabel_(k), a.n, r2_(a.m), r2_(a.int), r2_(a.pri), r2_(a.shB), r2_(a.shE), r2_(a.fee)]; }));

  // ---- เว็บใหม่: ทะเบียนผู้กู้ / ทะเบียนผู้ฝาก ----
  var nw = st.nw;
  if(nw && nw.people && nw.people.length){
    var byNo = {};
    (nw.rows || []).forEach(function(r){ (byNo[r.no] = byNo[r.no] || []).push(r); });
    var reg = nw.people.filter(function(x){ return !x.out; }).map(function(x){   // ไม่รวมคนที่ลาออก
      var rs = (byNo[x.no] || []).sort(function(a, b){ return a.p < b.p ? -1 : 1; });
      var debt = n_(x.debt0), sh = n_(x.share0), paid = 0, it = 0, dep = 0;
      rs.forEach(function(r){
        debt = has_(r.bal) ? +r.bal : r2_(debt - n_(r.pri) + n_(r.loan));
        var s2 = n_(r.sh) + n_(r.shx);                       // หุ้นประจำ + หุ้นเพิ่ม
        sh = r2_(sh + s2); paid += n_(r.m); it += n_(r.int); dep += s2; });
      return {x:x, rs:rs, debt:r2_(debt), sh:sh, paid:r2_(paid), it:r2_(it), dep:r2_(dep),
              last: rs.length ? perLabel_(rs[rs.length - 1].p) : ""};
    });
    sheetOut_("ทะเบียนผู้กู้",
      ["เลขสมาชิก","ชื่อ","หนี้ยกมา ธ.ค.68","งวดละ","ชำระรวมตั้งแต่ ม.ค.69","ดอกเบี้ย","หนี้คงเหลือ","หุ้นยกมา","หุ้นสะสม","บันทึกล่าสุด"],
      reg.filter(function(a){ return a.debt > 0.005; }).map(function(a){
        return [a.x.no, a.x.name, n_(a.x.debt0), n_(a.x.inst), a.paid, a.it, a.debt, n_(a.x.share0), a.sh, a.last]; }));
    sheetOut_("ทะเบียนผู้ฝาก",
      ["เลขสมาชิก","ชื่อ","หุ้นยกมา ธ.ค.68","หุ้นประจำเดือนละ","ฝากตั้งแต่ ม.ค.69","หุ้นสะสม","บันทึกล่าสุด"],
      reg.filter(function(a){ return a.debt <= 0.005; }).map(function(a){
        return [a.x.no, a.x.name, n_(a.x.share0), n_(a.x.shM), a.dep, a.sh, a.last]; }));
    var allRows = [];
    reg.forEach(function(a){ a.rs.forEach(function(r){
      allRows.push([r.p, a.x.no, a.x.name, r.d || "", n_(r.m), n_(r.int), n_(r.pri), n_(r.sh), n_(r.shx),
                    n_(r.loan), has_(r.bal) ? +r.bal : "", r.note || ""]); }); });
    allRows.sort(function(a, b){ return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : 1); });
    // งวดที่ 1 = พ.ค.68 · โอนได้ 25 ของเดือนก่อน – 5 ของเดือนนั้น
    allRows.forEach(function(r){ var a = String(r[0]).split("-");
      r.unshift((+a[0])*12 + (+a[1]) - (2568*12 + 5) + 1); r[1] = perLabel_(r[1]); });
    sheetOut_("บันทึกรายเดือน (เว็บใหม่)",
      ["งวดที่","เดือน","เลขสมาชิก","ชื่อ","วันที่รับ","ชำระรวม","ดอกเบี้ย","เงินต้น","หุ้นประจำ","หุ้นเพิ่ม","กู้เพิ่ม","หนี้คงเหลือ","หมายเหตุ"], allRows);
  }

  return "สร้างชีทอ่านง่ายเรียบร้อย";
}

function n_(v){ return (v === "" || v == null || isNaN(+v)) ? 0 : +v; }
function has_(v){ return !(v === "" || v == null); }
function r2_(v){ return Math.round(v * 100) / 100; }
var MTH_ = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
function perLabel_(p){ var a = String(p || "").split("-");
  return a.length === 2 ? MTH_[(+a[1] || 1) - 1] + String(a[0]).slice(2) : String(p || ""); }

/* อัปเดตชีทอ่านง่ายให้เองหลังบันทึก — เว้นอย่างน้อย 3 นาทีต่อครั้ง การบันทึกจะได้ไม่ช้า */
function autoBuild_(){
  try{
    var last = +prop_("SHEETS_BUILT_AT") || 0;
    if(Date.now() - last < 3 * 60 * 1000) return;
    buildSheets();
    setProp_("SHEETS_BUILT_AT", String(Date.now()));
  }catch(err){ /* ชีทอ่านง่ายเป็นของแถม ห้ามทำให้การบันทึกล้ม */ }
}

function sheetOut_(name, head, rows){
  var sh = ss_().getSheetByName(name) || ss_().insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight("bold").setBackground("#0B2C6B").setFontColor("#ffffff");
  if(rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, head.length);
}

/* ============ 4) ให้ Claude อ่านสลิป / สเตทเมนท์ ============ */
var AI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      description: "รายการเงินเข้าทุกบรรทัดที่อ่านได้ เรียงตามที่ปรากฏในเอกสาร",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["d", "t", "m", "a", "nm", "no"],
        properties: {
          d:  {type: "string", description: "วันที่โอน รูปแบบ YYYY-MM-DD ปี ค.ศ."},
          t:  {type: "string", description: "เวลา รูปแบบ HH:MM ไม่มีให้ใส่ 00:00"},
          m:  {type: "number", description: "ยอดเงินที่เข้าบัญชี หน่วยบาท"},
          a:  {type: "string", description: "เลขบัญชีผู้โอน 4 หลักท้าย เช่น X1366 ไม่มีให้ใส่ค่าว่าง"},
          nm: {type: "string", description: "ชื่อผู้โอนตามที่พิมพ์ในเอกสาร"},
          no: {type: "string", description: "เลขสมาชิกที่ตรงกับชื่อผู้โอน ถ้าไม่มั่นใจให้ใส่ค่าว่าง"}
        }
      }
    }
  }
};

function aiPrompt_(members, hint){
  var list = (members || []).map(function(m){ return m.no + " " + m.name; }).join("\n");
  return "นี่คือสลิปโอนเงินหรือสเตทเมนท์บัญชีธนาคารของกองทุน อ่านเฉพาะ«เงินที่เข้าบัญชี»ทุกบรรทัด "
       + "แล้วส่งกลับตามโครงสร้างที่กำหนด\n\n"
       + "กติกา\n"
       + "• คัดตัวเลขให้ตรงตามเอกสารทุกหลัก ทศนิยม 2 ตำแหน่ง ห้ามปัด ห้ามเดา\n"
       + "• วันที่ในเอกสารมักเป็น DD-MM-YY ปี พ.ศ. สองหลัก เช่น 05-07-69 ให้แปลงเป็น ค.ศ. 2026-07-05\n"
       + "• ข้ามรายการถอนเงิน โอนออก ค่าธรรมเนียม และยอดยกมา เอาเฉพาะเงินเข้า\n"
       + "• ถ้าชื่อผู้โอนตรงกับสมาชิกในรายชื่อข้างล่างให้ใส่เลขสมาชิกในช่อง no "
       + "ชื่อในสลิปมักเป็นอังกฤษพิมพ์ใหญ่ ให้เทียบทั้งชื่อต้นและนามสกุล "
       + "ถ้าไม่มั่นใจหรือมีคนชื่อซ้ำ ให้เว้นว่างไว้ ดีกว่าจับผิดคน\n"
       + "• บรรทัดไหนอ่านตัวเลขไม่ชัด ให้ข้ามไป อย่าเดา\n\n"
       + (list ? "รายชื่อสมาชิก (เลขสมาชิก ชื่อ-สกุล)\n" + list + "\n\n" : "")
       + (hint ? "คำสั่งเพิ่มเติมจากผู้ใช้: " + hint + "\n" : "");
}

/**
 * payload = JSON string {kind:"pdf"|"image", mime, data(base64), hint, members:[{no,name}]}
 * คืน JSON string {rows:[...], used, limit} หรือ {error}
 */
function ai(payload){
  try{
    var key = aiKey_();
    if(!key) throw new Error("ยังไม่ได้ตั้ง AI_KEY — เมนู กบข.นข. → ตั้งค่ากุญแจ AI");

    var p = (typeof payload === "string") ? JSON.parse(payload) : payload;
    if(!p || !p.data) throw new Error("ไม่มีไฟล์ส่งมา");

    var used = bumpQuota_();
    if(used > AI_DAILY_MAX) throw new Error("วันนี้ใช้ AI ครบ " + AI_DAILY_MAX + " ครั้งแล้ว พรุ่งนี้ค่อยใช้ใหม่");

    var isPdf = (p.kind === "pdf") || /pdf/i.test(p.mime || "");
    var media = isPdf
      ? {type: "document", source: {type: "base64", media_type: "application/pdf", data: p.data}}
      : {type: "image",    source: {type: "base64", media_type: p.mime || "image/png", data: p.data}};

    var body = {
      model: AI_MODEL,
      max_tokens: 16000,
      fallbacks: "default",
      output_config: {
        effort: "high",
        format: {type: "json_schema", schema: AI_SCHEMA}
      },
      messages: [{
        role: "user",
        content: [media, {type: "text", text: aiPrompt_(p.members, p.hint)}]
      }]
    };

    var res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01"
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode(), txt = res.getContentText();
    if(code !== 200){
      var detail = "";
      try{ detail = JSON.parse(txt).error.message; }catch(err){ detail = txt.slice(0, 200); }
      throw new Error("Claude ตอบกลับรหัส " + code + " — " + detail);
    }

    var msg = JSON.parse(txt);
    if(msg.stop_reason === "refusal") throw new Error("AI ปฏิเสธการอ่านไฟล์นี้");

    var out = "";
    (msg.content || []).forEach(function(b){ if(b.type === "text") out += b.text; });
    var parsed;
    try{ parsed = JSON.parse(out); }
    catch(err){ throw new Error("AI ตอบกลับไม่เป็นรูปแบบที่ตกลงไว้"); }

    var rows = (parsed.rows || []).filter(function(r){ return r && r.d && +r.m > 0; })
      .map(function(r){
        return {d: String(r.d), t: String(r.t || "00:00").slice(0, 5),
                m: +(+r.m).toFixed(2), a: String(r.a || ""),
                nm: String(r.nm || ""), no: String(r.no || "")};
      });

    return JSON.stringify({rows: rows, used: used, limit: AI_DAILY_MAX});
  }catch(err){
    return JSON.stringify({error: String((err && err.message) || err)});
  }
}

/* ============ AI อ่านรูปตารางผ่อน (เว็บใหม่) ============
   ตัวเลขที่อ่านไม่ได้ให้ส่ง -1 → ฝั่งหน้าเว็บเว้นว่างให้ผู้ใช้ใส่เอง                    */
var AI_SCHED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["meta", "rows"],
  properties: {
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["no", "name", "terms", "rate", "sh", "shx", "inst", "loan"],
      properties: {
        no:    {type: "string", description: "เลขที่สมาชิกที่พิมพ์อยู่ส่วนหัว เช่น 001 ไม่มีส่วนหัวให้ใส่ค่าว่าง"},
        name:  {type: "string", description: "ชื่อสมาชิกที่พิมพ์อยู่ส่วนหัว ไม่มีให้ใส่ค่าว่าง"},
        loan:  {type: "number", description: "วงเงินกู้สูงสุด (ยอดกู้ตั้งต้น) ไม่มีให้ใส่ -1"},
        terms: {type: "number", description: "จำนวนงวดทั้งหมด ไม่มีให้ใส่ -1"},
        rate:  {type: "number", description: "อัตราดอกเบี้ยต่อเดือน หน่วย % เช่น 1.00 ไม่มีให้ใส่ -1"},
        sh:    {type: "number", description: "ฝากหุ้นประจำต่อเดือน ไม่มีให้ใส่ -1"},
        shx:   {type: "number", description: "ฝากหุ้นเพิ่มต่อเดือน ไม่มีให้ใส่ -1"},
        inst:  {type: "number", description: "รวมยอดชำระต่อเดือน ไม่มีให้ใส่ -1"}
      }
    },
    rows: {
      type: "array",
      description: "ทุกแถวของตารางผ่อนที่เห็นในรูป เรียงตามงวด",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "m", "pri", "int", "sh", "shx", "bal"],
        properties: {
          n:   {type: "number", description: "งวดที่"},
          m:   {type: "number", description: "ยอดส่งต่อเดือน อ่านไม่ได้ให้ใส่ -1"},
          pri: {type: "number", description: "เงินต้น อ่านไม่ได้ให้ใส่ -1"},
          int: {type: "number", description: "ดอกเบี้ย อ่านไม่ได้ให้ใส่ -1"},
          sh:  {type: "number", description: "ฝากหุ้น อ่านไม่ได้หรือไม่มีคอลัมน์ให้ใส่ -1"},
          shx: {type: "number", description: "ฝากเพิ่ม อ่านไม่ได้หรือไม่มีคอลัมน์ให้ใส่ -1"},
          bal: {type: "number", description: "ยอดคงเหลือหลังงวดนี้ อ่านไม่ได้ให้ใส่ -1"}
        }
      }
    }
  }
};

/**
 * payload = JSON string {kind:"pdf"|"image", mime, data(base64), no, name}
 * คืน JSON string {meta, rows:[{n,m,pri,int,sh,shx,bal}], used, limit} หรือ {error}
 */
function aiSchedule(payload){
  try{
    var key = aiKey_();
    if(!key) throw new Error("ยังไม่ได้ตั้ง AI_KEY — เมนู กบข.นข. → ตั้งค่ากุญแจ AI");
    var p = (typeof payload === "string") ? JSON.parse(payload) : payload;
    if(!p || !p.data) throw new Error("ไม่มีไฟล์ส่งมา");
    var used = bumpQuota_();
    if(used > AI_DAILY_MAX) throw new Error("วันนี้ใช้ AI ครบ " + AI_DAILY_MAX + " ครั้งแล้ว พรุ่งนี้ค่อยใช้ใหม่");

    var isPdf = (p.kind === "pdf") || /pdf/i.test(p.mime || "");
    var media = isPdf
      ? {type: "document", source: {type: "base64", media_type: "application/pdf", data: p.data}}
      : {type: "image",    source: {type: "base64", media_type: p.mime || "image/png", data: p.data}};
    var prompt = "นี่คือรูปตารางผ่อนชำระเงินกู้ของสมาชิกกองทุน (มักเป็นหน้าพิมพ์ของ «เครื่องคำนวณวงเงินกู้สูงสุด») "
      + "อ่านส่วนหัวและทุกแถวของตารางแล้วส่งกลับตามโครงสร้างที่กำหนด\n\n"
      + "ส่วนหัวอยู่เหนือตาราง มีบรรทัดประมาณ: เลขที่สมาชิก · ชื่อ · จำนวนงวด · อัตราดอกเบี้ย/เดือน · ฝากเงินหุ้นประจำ · ฝากหุ้นเพิ่ม · "
      + "ยอดชำระ (เงินต้น + ดอกเบี้ย) · รวมยอดชำระต่อเดือน · วงเงินกู้สูงสุด\n"
      + "• no = เลขที่สมาชิก, name = ชื่อ (ตัดคำนำหน้า «คุณ» ออกได้), loan = วงเงินกู้สูงสุด, inst = รวมยอดชำระต่อเดือน (ไม่ใช่ยอดชำระเงินต้น+ดอกเบี้ย)\n"
      + "• sh = ฝากเงินหุ้นประจำ, shx = ฝากหุ้นเพิ่ม (เอาจำนวนเงิน ไม่เอาตัวเลขเปอร์เซ็นต์ในวงเล็บ)\n"
      + "• รูปที่เป็นหน้าถัดไปของตารางเดิมจะไม่มีส่วนหัว ให้ใส่ no และ name เป็นค่าว่าง\n\n"
      + "กติกา\n"
      + "• คอลัมน์ทั่วไป: งวดที่ · ยอดส่งต่อเดือน · เงินต้น · ดอกเบี้ย · ฝากหุ้น · ฝากเพิ่ม · ยอดคงเหลือ\n"
      + "• คัดตัวเลขให้ตรงตามรูปทุกหลัก ทศนิยม 2 ตำแหน่ง ห้ามปัด ห้ามคำนวณเติมเอง ห้ามเดา\n"
      + "• ช่องที่อ่านไม่ชัด ว่าง หรือไม่มีคอลัมน์นั้น ให้ใส่ -1\n"
      + "• ยอดคงเหลือ 0 ให้ใส่ 0 (ไม่ใช่ -1)\n"
      + "• meta อ่านจากส่วนหัวเหนือตาราง (จำนวนงวด อัตราดอกเบี้ย ฝากหุ้นประจำ ฝากหุ้นเพิ่ม รวมยอดชำระต่อเดือน) ไม่มีให้ใส่ -1\n";

    var res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: {"x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01"},
      payload: JSON.stringify({
        model: AI_MODEL, max_tokens: 16000, fallbacks: "default",
        output_config: {effort: "high", format: {type: "json_schema", schema: AI_SCHED_SCHEMA}},
        messages: [{role: "user", content: [media, {type: "text", text: prompt}]}]
      }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode(), txt = res.getContentText();
    if(code !== 200){
      var detail = "";
      try{ detail = JSON.parse(txt).error.message; }catch(err){ detail = txt.slice(0, 200); }
      throw new Error("Claude ตอบกลับรหัส " + code + " — " + detail);
    }
    var msg = JSON.parse(txt);
    if(msg.stop_reason === "refusal") throw new Error("AI ปฏิเสธการอ่านไฟล์นี้");
    var out = "";
    (msg.content || []).forEach(function(b){ if(b.type === "text") out += b.text; });
    var parsed;
    try{ parsed = JSON.parse(out); }catch(err){ throw new Error("AI ตอบกลับไม่เป็นรูปแบบที่ตกลงไว้"); }

    var v = function(x){ x = +x; return (isFinite(x) && x >= 0) ? Math.round(x * 100) / 100 : null; };   // -1 = ว่าง
    var meta = {}, M = parsed.meta || {};
    ["terms", "rate", "sh", "shx", "inst", "loan"].forEach(function(k){ var x = v(M[k]); if(x !== null) meta[k] = x; });
    var no = String(M.no || "").replace(/[^0-9]/g, ""), nm = String(M.name || "").replace(/\s+/g, " ").trim();
    if(no) meta.no = no;
    if(nm) meta.name = nm;
    var rows = (parsed.rows || []).filter(function(r){ return r && +r.n >= 1; }).map(function(r){
      var o = {n: Math.round(+r.n)};
      ["m", "pri", "int", "sh", "shx", "bal"].forEach(function(k){ var x = v(r[k]); if(x !== null) o[k] = x; });
      return o;
    });
    return JSON.stringify({meta: meta, rows: rows, used: used, limit: AI_DAILY_MAX});
  }catch(err){
    return JSON.stringify({error: String((err && err.message) || err)});
  }
}

/* นับโควตารายวัน */
function bumpQuota_(){
  var k = "AI_USED_" + Utilities.formatDate(new Date(), TZ, "yyyyMMdd");
  var n = (+prop_(k) || 0) + 1;
  setProp_(k, String(n));
  return n;
}

/* ============ เมนูในหน้า Sheet ============ */
function onOpen(){
  SpreadsheetApp.getUi().createMenu("กบข.นข.")
    .addItem("1) สร้างชีททั้งหมด", "menuInit")
    .addItem("2) อัปเดตชีทอ่านง่ายจากข้อมูลล่าสุด", "menuBuild")
    .addItem("3) เช็คว่าระบบพร้อมใช้หรือยัง", "menuCheck")
    .addSeparator()
    .addItem("ตั้งค่ารหัสเชื่อมต่อ (REMOTE_TOKEN)", "menuToken")
    .addItem("ตั้งค่ากุญแจ AI (AI_KEY)", "menuKey")
    .addSeparator()
    .addItem("สำรองข้อมูลเป็นไฟล์ JSON ใน Drive", "menuBackup")
    .addToUi();
}

function menuInit(){
  dataSheet_(true);
  buildSheets();
  SpreadsheetApp.getUi().alert("สร้างชีทเรียบร้อย\n\nขั้นต่อไป: ตั้งรหัสเชื่อมต่อและกุญแจ AI ในเมนูเดียวกัน "
    + "แล้วกลับไปที่หน้าโปรแกรม กด «นำเข้า» ไฟล์ JSON สำรอง เพื่อยัดข้อมูลเข้า Sheets ครั้งแรก");
}

function menuBuild(){ SpreadsheetApp.getUi().alert(buildSheets()); }

function menuCheck(){
  var d, n = 0, err = "";
  try{ d = readAll_(); n = d.db.members.length; }catch(e){ err = String(e.message || e); }
  SpreadsheetApp.getUi().alert(
    "สถานะระบบ\n\n"
    + "• ชีทข้อมูล: " + (dataSheet_(false) ? "มีแล้ว" : "ยังไม่มี — กด «1) สร้างชีททั้งหมด»") + "\n"
    + "• ข้อมูลในชีท: " + (err ? "อ่านไม่ได้ (" + err + ")" : n + " สมาชิก") + "\n"
    + "• รหัสเชื่อมต่อ: " + (token_() ? "ตั้งแล้ว" : "ยังไม่ได้ตั้ง") + "\n"
    + "• AI: " + (aiKey_() ? "พร้อมใช้" : "ยังไม่ได้ใส่กุญแจ") + "\n"
    + "• ใช้ AI วันนี้: " + (+prop_("AI_USED_" + Utilities.formatDate(new Date(), TZ, "yyyyMMdd")) || 0)
    + " / " + AI_DAILY_MAX + " ครั้ง\n\n"
    + "อย่าลืม: ทุกครั้งที่แก้ Code.gs ต้อง Deploy → Manage deployments → ✏️ → New version → Deploy");
}

function menuToken(){
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt("รหัสเชื่อมต่อ (REMOTE_TOKEN)",
    "ตั้งรหัสยาว ๆ เดาไม่ได้ แล้วบอกเฉพาะกรรมการที่ต้องใช้\nรหัสปัจจุบัน: " + (token_() ? "ตั้งไว้แล้ว" : "ยังไม่ได้ตั้ง"),
    ui.ButtonSet.OK_CANCEL);
  if(r.getSelectedButton() !== ui.Button.OK) return;
  var v = r.getResponseText().trim();
  if(v.length < 12){ ui.alert("สั้นเกินไป ควรยาวอย่างน้อย 12 ตัวอักษร"); return; }
  setProp_("REMOTE_TOKEN", v);
  ui.alert("ตั้งรหัสแล้ว — ห้ามนำรหัสนี้ไปใส่ในไฟล์ที่เปิดสาธารณะ เช่น GitHub");
}

function menuKey(){
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt("กุญแจ AI (AI_KEY)",
    "วาง API key ของ Anthropic ขึ้นต้นด้วย sk-ant-\nสถานะ: " + (aiKey_() ? "ใส่ไว้แล้ว" : "ยังไม่ได้ใส่"),
    ui.ButtonSet.OK_CANCEL);
  if(r.getSelectedButton() !== ui.Button.OK) return;
  var v = r.getResponseText().trim();
  if(!v){ ui.alert("ไม่ได้ใส่อะไรมา"); return; }
  setProp_("AI_KEY", v);
  ui.alert("ใส่กุญแจแล้ว ลองกด «3) เช็คว่าระบบพร้อมใช้หรือยัง» อีกครั้ง");
}

function menuBackup(){
  var txt = JSON.stringify(readPacked_());
  var name = "kbk-backup-" + Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmm") + ".json";
  var f = DriveApp.createFile(name, txt, MimeType.PLAIN_TEXT);
  SpreadsheetApp.getUi().alert("สำรองแล้ว\n\nไฟล์: " + name + "\nอยู่ใน Drive ของคุณ\n\n" + f.getUrl());
}
