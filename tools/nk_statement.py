# -*- coding: utf-8 -*-
"""
nk_statement.py — อ่านสเตทเมนท์ธนาคาร (PDF) ของ กบข.นข. ให้เป็นฐานข้อมูล

รองรับ PDF สองแบบในไฟล์เดียวกัน
  1. หน้าที่เป็นข้อความ  → ดึงคำพร้อมพิกัดด้วย PyMuPDF แล้วจัดเป็นแถวตามตำแหน่ง y
  2. หน้าที่เป็นรูปภาพ   → เรนเดอร์เป็น PNG แล้วให้ Claude (vision) ถอดเป็นข้อความบรรทัดละรายการ
                           ผลถูกเก็บไว้ที่ tools/ocr/<ชื่อไฟล์>_p<หน้า>.txt เพื่อตรวจ/แก้ด้วยมือได้
                           (ถ้ามีไฟล์นี้อยู่แล้วจะใช้ไฟล์ ไม่เรียก AI ซ้ำ)

ทุกบรรทัดถูกตรวจด้วย «ยอดคงเหลือ» — ยอดก่อนหน้า ± ยอดรายการ ต้องเท่ากับยอดคงเหลือของบรรทัดนั้น
และผลรวมต่อสเตทเมนท์ต้องตรงกับหัวกระดาษ (รวมฝากเงิน N รายการ / รวมถอนเงิน N รายการ)
ถ้าไม่ตรง จะรายงานให้เห็นชัด ๆ แทนที่จะปล่อยผ่าน

ใช้งาน:
  python tools/nk_statement.py                      # อ่าน *.pdf ในโฟลเดอร์โปรเจกต์ → out/
  python tools/nk_statement.py file1.pdf file2.pdf  # ระบุไฟล์เอง
  python tools/nk_statement.py --root .             # อ่าน PDF จากโฟลเดอร์ปัจจุบัน (วางสคริปต์ที่ไหนก็ได้)
  python tools/nk_statement.py --members kbk-backup.json   # ใส่ชื่อสมาชิกจากไฟล์สำรองของโปรแกรม

หมายเหตุ: ผลลัพธ์ใน out/ และข้อความที่ถอดใน tools/ocr/ มีชื่อสมาชิกและยอดเงินจริง
ทั้งสองโฟลเดอร์อยู่ใน .gitignore แล้ว — อย่านำขึ้น repo สาธารณะ

ผลลัพธ์ (โฟลเดอร์ out/):
  transactions.json / transactions.csv  รายการทุกบรรทัดที่อ่านได้ (ไม่ซ้ำ)
  persons.json                          สรุปรายคน: กี่ครั้ง รวมเท่าไร วันไหนบ้าง แยกงวด
  paste_for_app.txt                     ข้อความสำหรับวางในโปรแกรม (แท็บ รับชำระ → วางข้อความ)
  dashboard.html                        แดชบอร์ดรายคน เปิดได้เลย ไม่ต้องต่อเน็ต
  report.md                             รายงานการตรวจสอบ
"""
import sys, os, re, io, json, csv, glob, base64, argparse, datetime
from collections import OrderedDict, defaultdict

try:
    import pymupdf
except ImportError:  # pragma: no cover
    import fitz as pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OCR_DIR = os.path.join(HERE, "ocr")
OUT_DIR = os.path.join(ROOT, "out")
TEMPLATE = os.path.join(HERE, "dashboard_template.html")

# ---------- ตารางจับคู่คำในสลิป → เลขสมาชิก (คัดมาจาก index.html ของโปรแกรม) ----------
SLIP2NO = {"SARAWUT":"001","PIMMASO":"001","KANPHITCHA":"002","KH":"002","PONGSAK":"014","SALEEP":"014",
  "SUWAT":"039","TADSA":"039","PIMWISUT":"041","HOMD":"041","ORNUMA":"011","TRONGJ":"011","NONTAKORN":"044",
  "PIEPK":"044","KANYAVEE":"037","SACH":"037","WUTTHINAN":"009","SEED":"009","WISARAT":"010","PHUKH":"010",
  "PHAI":"023","PRAERUNG":"024","SIRILAK":"032","BUAKO":"032","PANNITA":"007","BOONK":"007","SUPAKANDA":"012",
  "KAEW":"012","SUTAWAN":"019","KONGAI":"019","PAPHITCHAYA":"022","KUMDOK":"022","JITTIPAN":"022",
  "WANWISA":"005","CHOMCH":"005","SUWANNA":"025","PATTAW":"025","WEERA":"026","WANNAK":"026",
  "DUANGRUDEE":"020","POOMIP":"020","DOUNGDUEN":"008","THEERAPON":"031","BUTR":"031","NAMVAN":"017",
  "SAYN":"017","PATTAMON":"006","NGAMYINGY":"006"}
EN2TH = {"SARAWUT":"ศราวุธ","PRAERUNG":"แพรรุ้ง","PONGSAK":"พงษ์ศักดิ์","SUWAT":"สุวัฒน์","PIMWISUT":"ภิมวิสุธ",
  "ORNUMA":"อรอุมา","NONTAKORN":"นนทกร","KANYAVEE":"กัญญาวีร์","WUTTHINAN":"วุฒินันท์","WISARAT":"วิสารัช",
  "PHAI":"ไผ่","SIRILAK":"สิริลักษณ์","PANNITA":"พรรณิตา","SUPAKANDA":"ศุภกานดา","SUTAWAN":"สุธาวัลย์",
  "PAPHITCHAYA":"ปพิชญา","WANWISA":"วันวิสา","SUWANNA":"สุวรรณา","KANPHITCHA":"กานต์พิชชา","WEERA":"วีระ",
  "DUANGRUDEE":"ดวงฤดี","DOUNGDUEN":"ดวงเดือน","THEERAPON":"ธีรพร","NAMVAN":"น้ำหวาน","PATTAMON":"พัทธมน"}

MONTH_TH = {1:"ม.ค.",2:"ก.พ.",3:"มี.ค.",4:"เม.ย.",5:"พ.ค.",6:"มิ.ย.",7:"ก.ค.",8:"ส.ค.",9:"ก.ย.",10:"ต.ค.",11:"พ.ย.",12:"ธ.ค."}
CUT_DAY = 20           # โอนตั้งแต่วันที่ 20 นับเป็นงวดเดือนถัดไป (ค่าเริ่มต้นเดียวกับโปรแกรม)
BANK_OF_CHANNEL = {"K PLUS":"KBANK", "MAKE by KBank":"KBANK", "Internet/Mobile KTB":"KTB", "Internet/Mobile SCB":"SCB"}
def bank_of_channel(ch):
    if ch in BANK_OF_CHANNEL: return BANK_OF_CHANNEL[ch]
    if re.search(r"kbank|k plus|k-plus", ch, re.I): return "KBANK"
    m = re.search(r"(KTB|SCB|BBL|BAY|TTB|GSB|BAAC|UOB|CIMB|LHB|TISCO|KKP)", ch)
    return m.group(1) if m else ""

NUM = r"\d{1,3}(?:,\d{3})*\.\d{2}"
RE_ROW  = re.compile(r"^(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+?)\s+(" + NUM + r")\s+(" + NUM + r")\s*(.*)$")
RE_OPEN = re.compile(r"^(\d{2}-\d{2}-\d{2})\s+ยอดยกมา\s+(" + NUM + r")")
RE_PERIOD = re.compile(r"รอบระหว่างวันที่\s*(\d{2}/\d{2}/\d{4})\s*-\s*(\d{2}/\d{2}/\d{4})")
RE_TOT_IN  = re.compile(r"รวมฝากเงิน\s*(\d+)\s*รายการ\s*(" + NUM + r")")
RE_TOT_OUT = re.compile(r"รวมถอนเงิน\s*(\d+)\s*รายการ\s*(" + NUM + r")")
RE_CLOSE   = re.compile(r"ยอดยกไป\s*(" + NUM + r")")
RE_FROM = re.compile(r"^(.*?)\s*จาก\s+(?:(KTB|SCB|BBL|BAY|TTB|TMB|GSB|KBANK|BAAC|UOB|CIMB|LHB|TISCO|KKP)\s+)?(X\d{4})\s*(.*)$")

def money(s): return round(float(s.replace(",", "")), 2)
def fmt(n): return f"{n:,.2f}"

def iso_date(d):  # 05-07-26 → 2026-07-05
    dd, mm, yy = d.split("-")
    return f"20{yy}-{mm}-{dd}"

def period_of(iso, cut=CUT_DAY):  # งวด (ปี พ.ศ.-เดือน) ตามกติกาวันตัดรอบของโปรแกรม
    y, m, d = map(int, iso.split("-"))
    if d >= cut:
        m += 1
        if m > 12: m, y = 1, y + 1
    return f"{y+543}-{m:02d}"

def month_of(iso):
    y, m, _ = map(int, iso.split("-"))
    return f"{y+543}-{m:02d}"

def label_period(p):
    y, m = p.split("-")
    return f"{MONTH_TH[int(m)]}{y[2:]}"

def clean_name(nm):
    nm = re.sub(r"\++\s*$", "", nm).strip()
    nm = re.sub(r"^(MRS?\.?|MISS|MS\.?)\s*", "", nm, flags=re.I)
    nm = re.sub(r"^(MRS?\.?|MISS|MS\.?)(?=[A-Z])", "", nm, flags=re.I)      # MISSWANWISA → WANWISA
    nm = re.sub(r"^(นางสาว|นาง|นาย|น\.ส\.)\s*", "", nm)
    return re.sub(r"\s+", " ", nm).strip()

def is_withdraw(kind):
    return any(k in kind for k in ("ถอน", "หัก", "ค่าธรรมเนียม", "โอนออก", "จ่าย"))

# ---------- แปลง 1 บรรทัดข้อความ → รายการ ----------
def parse_line(line):
    line = line.strip()
    # ตัดข้อความแนวตั้งข้างกระดาษ (เช่น "(03-25)" หรือ "(FM702-CA_SA-V.1)") ที่บังเอิญอยู่แถวเดียวกับรายการ
    dm = re.search(r"(?<![\d-])\d{2}-\d{2}-\d{2}\s", line)
    if dm and dm.start() > 0:
        line = line[dm.start():]
    m = RE_OPEN.match(line)
    if m:
        return {"open": True, "date": iso_date(m.group(1)), "balance": money(m.group(2))}
    m = RE_ROW.match(line)
    if not m: return None
    d, t, kind, amt, bal, rest = m.groups()
    row = {"date": iso_date(d), "time": t, "kind": kind.strip(), "amount": money(amt), "balance": money(bal),
           "channel": "", "bank": "", "account": "", "name": "", "ref": "", "raw": line}
    row["in"] = not is_withdraw(row["kind"])
    fm = RE_FROM.match(rest)
    if fm:
        ch, bank, acct, nm = fm.groups()
        row["channel"] = ch.strip()
        row["bank"] = bank or bank_of_channel(ch.strip())
        row["account"] = acct
        row["name"] = clean_name(nm)
    else:
        rm = re.search(r"รหัสอ้างอิง\s*(\S+)", rest)
        row["ref"] = rm.group(1) if rm else ""
        row["channel"] = re.sub(r"รหัสอ้างอิง.*$", "", rest).strip()
    return row

# ---------- ข้อความจากหน้า PDF ที่มีตัวอักษร ----------
def page_lines(page):
    words = page.get_text("words")             # x0,y0,x1,y1,word,block,line,wordno
    words.sort(key=lambda w: (round(w[1]), w[0]))
    rows, cur, cur_y = [], [], None
    for w in words:
        if cur_y is None or abs(w[1] - cur_y) > 4:
            if cur: rows.append(cur)
            cur, cur_y = [w], w[1]
        else:
            cur.append(w)
    if cur: rows.append(cur)
    out = []
    for r in rows:
        r.sort(key=lambda w: w[0])
        out.append(" ".join(w[4] for w in r))
    return out

# ---------- หน้าที่เป็นรูปภาพ → Claude vision ----------
OCR_PROMPT = """นี่คือภาพสเตทเมนท์บัญชีเงินฝากธนาคาร (ภาษาไทย) ให้ถอดข้อมูลทุกรายการออกมาเป็นข้อความล้วน บรรทัดละ 1 รายการ ตามรูปแบบนี้เท่านั้น:

รอบระหว่างวันที่ DD/MM/YYYY - DD/MM/YYYY
ยอดยกไป 0,000.00
รวมถอนเงิน N รายการ 0,000.00
รวมฝากเงิน N รายการ 0,000.00
DD-MM-YY ยอดยกมา 0,000.00
DD-MM-YY HH:MM <รายการ> <ยอดเงิน> <ยอดคงเหลือ> <ช่องทาง> จาก <ธนาคาร> X#### <ชื่อผู้โอน>++
DD-MM-YY HH:MM ถอนเงินสด <ยอดเงิน> <ยอดคงเหลือ> <สาขา> รหัสอ้างอิง <รหัส>

กติกา:
- คัดลอกตัวเลขให้ตรงตามภาพทุกหลัก รวมเครื่องหมายจุลภาคและทศนิยม 2 ตำแหน่ง
- ชื่อผู้โอนให้คัดตามที่พิมพ์ในภาพ (อังกฤษพิมพ์ใหญ่ หรือไทย) ถ้าชื่อขึ้นบรรทัดใหม่ในภาพเพราะ "+" ให้ต่อเป็นบรรทัดเดียว ลงท้าย ++
- ถ้าช่องทางเป็น K PLUS จะไม่มีชื่อธนาคารหลังคำว่า "จาก" ให้เขียน "จาก X#### ชื่อ++"
- ห้ามอธิบาย ห้ามใส่หัวตาราง ห้ามใส่ markdown — ตอบเป็นบรรทัดข้อมูลเท่านั้น
- ตรวจทานว่า ยอดคงเหลือบรรทัดก่อน ± ยอดเงินบรรทัดนี้ = ยอดคงเหลือบรรทัดนี้ ทุกบรรทัด ก่อนตอบ"""

def ocr_with_claude(png_bytes, hint=""):
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("ยังไม่ได้ติดตั้ง SDK — รัน: pip install anthropic")
    client = anthropic.Anthropic()          # อ่านกุญแจจาก ANTHROPIC_API_KEY
    content = [{"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                            "data": base64.standard_b64encode(png_bytes).decode()}},
               {"type": "text", "text": OCR_PROMPT + (("\n\nข้อมูลเพิ่มเติม: " + hint) if hint else "")}]
    kwargs = dict(model="claude-opus-5", max_tokens=16000, messages=[{"role": "user", "content": content}])
    try:   # ให้เซิร์ฟเวอร์สลับไปรุ่นสำรองเองถ้ารุ่นหลักปฏิเสธคำขอ
        resp = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
    except TypeError:
        resp = client.messages.create(**kwargs)
    if resp.stop_reason == "refusal":
        raise RuntimeError("AI ปฏิเสธการอ่านภาพนี้")
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")

def ocr_cache_path(pdf_path, pno):
    stem = os.path.splitext(os.path.basename(pdf_path))[0]
    return os.path.join(OCR_DIR, f"{stem}_p{pno}.txt")

def image_page_lines(pdf_path, page, pno, allow_ai, log):
    cache = ocr_cache_path(pdf_path, pno)
    if os.path.exists(cache):
        log.append(f"  หน้า {pno}: รูปภาพ → ใช้ข้อความที่ถอดไว้แล้ว {os.path.relpath(cache, ROOT)}")
        with io.open(cache, encoding="utf-8") as f:
            return [l for l in f.read().splitlines() if l.strip() and not l.startswith("#")]
    if not allow_ai:
        log.append(f"  หน้า {pno}: รูปภาพ — ยังไม่มีข้อความที่ถอดไว้ และไม่ได้เปิดใช้ AI (ตั้ง ANTHROPIC_API_KEY แล้วรันใหม่)")
        return None
    log.append(f"  หน้า {pno}: รูปภาพ → ส่งให้ Claude อ่าน …")
    png = page.get_pixmap(dpi=170).tobytes("png")
    text = ocr_with_claude(png)
    os.makedirs(OCR_DIR, exist_ok=True)
    with io.open(cache, "w", encoding="utf-8") as f:
        f.write(f"# ถอดโดย Claude จาก {os.path.basename(pdf_path)} หน้า {pno} เมื่อ {datetime.date.today()} — ตรวจแล้วแก้ได้ในไฟล์นี้\n")
        f.write(text.strip() + "\n")
    return [l for l in text.splitlines() if l.strip()]

# ---------- อ่าน 1 ไฟล์ ----------
def read_pdf(pdf_path, allow_ai, log):
    doc = pymupdf.open(pdf_path)
    statements, cur = [], None
    log.append(f"{os.path.basename(pdf_path)} — {len(doc)} หน้า")
    for i, page in enumerate(doc):
        pno = i + 1
        if len(page.get_text().strip()) > 50:
            lines = page_lines(page)
            log.append(f"  หน้า {pno}: ข้อความ")
        else:
            lines = image_page_lines(pdf_path, page, pno, allow_ai, log)
            if lines is None:
                statements.append({"file": os.path.basename(pdf_path), "page": pno, "unreadable": True, "rows": []})
                continue
        text = "\n".join(lines)
        pm = RE_PERIOD.search(text)
        # หน้าต่อ (2/2) จะไม่มีหัวสรุปซ้ำ — ถ้ามีหัวสรุป แปลว่าเป็นสเตทเมนท์อีกใบ (ไฟล์บางไฟล์ใส่ซ้ำ)
        same = (pm and cur and cur.get("period") == (pm.group(1), pm.group(2))
                and not RE_CLOSE.search(text) and not RE_TOT_IN.search(text))
        if same:
            log[-1] += " (หน้าต่อของสเตทเมนท์เดียวกัน)"
        if (pm and not same) or cur is None:
            cur = {"file": os.path.basename(pdf_path), "page": pno, "period": (pm.group(1), pm.group(2)) if pm else None,
                   "open": None, "close": None, "tot_in": None, "tot_out": None, "rows": [], "errors": []}
            statements.append(cur)
        for rx, key in ((RE_TOT_IN, "tot_in"), (RE_TOT_OUT, "tot_out")):
            m = rx.search(text)
            if m: cur[key] = (int(m.group(1)), money(m.group(2)))
        m = RE_CLOSE.search(text)
        if m: cur["close"] = money(m.group(1))
        for ln in lines:
            r = parse_line(ln)
            if not r: continue
            if r.get("open"):
                if cur["open"] is None: cur["open"] = r["balance"]
                continue
            r["file"], r["page"] = os.path.basename(pdf_path), pno
            cur["rows"].append(r)
    return statements

# ---------- ตรวจสอบ ----------
def validate(st):
    errs = []
    bal = st.get("open")
    for r in st["rows"]:
        if bal is not None:
            exp = round(bal + r["amount"], 2) if r["in"] else round(bal - r["amount"], 2)
            if abs(exp - r["balance"]) > 0.005:
                alt = round(bal - r["amount"], 2) if r["in"] else round(bal + r["amount"], 2)
                if abs(alt - r["balance"]) <= 0.005:
                    r["in"] = not r["in"]
                    errs.append(f"สลับทิศทางให้: {r['date']} {r['time']} {r['kind']} {fmt(r['amount'])}")
                else:
                    errs.append(f"ยอดคงเหลือไม่ต่อกัน: {r['date']} {r['time']} {fmt(r['amount'])} → คาด {fmt(exp)} แต่ในเอกสาร {fmt(r['balance'])}")
                    r["suspect"] = True
        bal = r["balance"]
    ins = [r for r in st["rows"] if r["in"]]
    outs = [r for r in st["rows"] if not r["in"]]
    if st.get("tot_in"):
        n, s = st["tot_in"]
        if n != len(ins) or abs(s - round(sum(r["amount"] for r in ins), 2)) > 0.005:
            errs.append(f"รวมฝากเงินไม่ตรงหัวกระดาษ: อ่านได้ {len(ins)} รายการ {fmt(sum(r['amount'] for r in ins))} / เอกสารบอก {n} รายการ {fmt(s)}")
    if st.get("tot_out"):
        n, s = st["tot_out"]
        if n != len(outs) or abs(s - round(sum(r["amount"] for r in outs), 2)) > 0.005:
            errs.append(f"รวมถอนเงินไม่ตรงหัวกระดาษ: อ่านได้ {len(outs)} รายการ {fmt(sum(r['amount'] for r in outs))} / เอกสารบอก {n} รายการ {fmt(s)}")
    if st.get("close") is not None and st["rows"] and abs(st["rows"][-1]["balance"] - st["close"]) > 0.005:
        errs.append(f"ยอดยกไปไม่ตรง: บรรทัดสุดท้าย {fmt(st['rows'][-1]['balance'])} / หัวกระดาษ {fmt(st['close'])}")
    st["errors"] = errs
    st["n_in"], st["sum_in"] = len(ins), round(sum(r["amount"] for r in ins), 2)
    st["n_out"], st["sum_out"] = len(outs), round(sum(r["amount"] for r in outs), 2)
    return errs

# ---------- รวม + จัดกลุ่มรายคน ----------
def guess_member_no(name):
    for wd in re.split(r"[^A-Z]+", name.upper()):
        if len(wd) >= 4 and wd in SLIP2NO: return SLIP2NO[wd]
    return ""

def thai_hint(name):
    for en, th in EN2TH.items():
        if en in name.upper(): return th
    return ""

def load_members(path):
    if not path: return {}
    with io.open(path, encoding="utf-8") as f:
        j = json.load(f)
    return {m["no"]: m.get("name", "") for m in j.get("members", [])}

def build(statements, members):
    seen, txs = set(), []
    for st in statements:
        for r in st["rows"]:
            k = (r["date"], r["time"], r["amount"], r["balance"])
            if k in seen: continue
            seen.add(k)
            txs.append(r)
    txs.sort(key=lambda r: (r["date"], r["time"], r["balance"]))
    for r in txs:
        r["period"] = period_of(r["date"])
        r["month"] = month_of(r["date"])
        if r["account"]:
            r["payer"] = f"{r['bank']} {r['account']}".strip()
            r["member_no"] = guess_member_no(r["name"])
            r["member_name"] = members.get(r["member_no"], "") or thai_hint(r["name"])
        else:
            r["payer"], r["member_no"], r["member_name"] = "", "", ""

    persons = OrderedDict()
    for r in txs:
        if not r["in"] or not r["payer"]: continue
        p = persons.setdefault(r["payer"], {"key": r["payer"], "bank": r["bank"], "account": r["account"],
                 "names": [], "member_no": r["member_no"], "member_name": r["member_name"],
                 "count": 0, "total": 0.0, "first": r["date"], "last": r["date"],
                 "by_period": OrderedDict(), "by_month": OrderedDict(), "tx": []})
        if r["name"] and r["name"] not in p["names"]: p["names"].append(r["name"])
        p["count"] += 1; p["total"] = round(p["total"] + r["amount"], 2)
        p["first"] = min(p["first"], r["date"]); p["last"] = max(p["last"], r["date"])
        p["by_period"][r["period"]] = round(p["by_period"].get(r["period"], 0) + r["amount"], 2)
        p["by_month"][r["month"]] = round(p["by_month"].get(r["month"], 0) + r["amount"], 2)
        p["tx"].append({"date": r["date"], "time": r["time"], "amount": r["amount"], "period": r["period"],
                        "kind": r["kind"], "channel": r["channel"], "file": r["file"], "page": r["page"],
                        "suspect": bool(r.get("suspect"))})
    for p in persons.values():
        p["name"] = p["names"][0] if p["names"] else "(ไม่มีชื่อ)"
    plist = sorted(persons.values(), key=lambda p: (-p["total"], p["name"]))
    return txs, plist

# ---------- ส่งออก ----------
def write_outputs(statements, txs, persons, log):
    os.makedirs(OUT_DIR, exist_ok=True)
    periods = sorted({r["period"] for r in txs})
    months = sorted({r["month"] for r in txs})
    meta = {"generated": datetime.datetime.now().isoformat(timespec="seconds"), "cut_day": CUT_DAY,
            "periods": periods, "period_labels": {p: label_period(p) for p in periods},
            "months": months, "month_labels": {m: label_period(m) for m in months},
            "statements": [{k: v for k, v in st.items() if k != "rows"} | {"n_rows": len(st["rows"])} for st in statements]}
    with io.open(os.path.join(OUT_DIR, "transactions.json"), "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "transactions": txs}, f, ensure_ascii=False, indent=1)
    with io.open(os.path.join(OUT_DIR, "persons.json"), "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "persons": persons}, f, ensure_ascii=False, indent=1)
    with io.open(os.path.join(OUT_DIR, "transactions.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["วันที่", "เวลา", "รายการ", "เข้า/ออก", "ยอด", "ยอดคงเหลือ", "ช่องทาง", "ธนาคาร", "บัญชี", "ชื่อในสเตทเมนท์",
                    "เลขสมาชิก(เดา)", "ชื่อสมาชิก", "งวด", "เดือน", "ไฟล์", "หน้า", "ต้องตรวจ"])
        for r in txs:
            w.writerow([r["date"], r["time"], r["kind"], "เข้า" if r["in"] else "ออก", f"{r['amount']:.2f}", f"{r['balance']:.2f}",
                        r["channel"], r["bank"], r["account"], r["name"], r["member_no"], r["member_name"],
                        label_period(r["period"]), label_period(r["month"]), r["file"], r["page"], "✓" if r.get("suspect") else ""])
    # ข้อความสำหรับวางในโปรแกรม (รูปแบบเดียวกับที่ parse() ของ index.html อ่านได้)
    with io.open(os.path.join(OUT_DIR, "paste_for_app.txt"), "w", encoding="utf-8") as f:
        for r in txs:
            if not r["in"] or not r["account"]: continue
            d = r["date"]; dd = f"{d[8:10]}-{d[5:7]}-{d[2:4]}"
            bank = (r["bank"] + " ") if r["channel"] != "K PLUS" and r["bank"] else ""
            f.write(f"{dd}  {r['time']}  รับโอนเงิน  {fmt(r['amount'])}  {fmt(r['balance'])}  {r['channel']}  จาก {bank}{r['account']} {r['name']}++\n")
    # รายงาน
    rep = ["# รายงานการอ่านสเตทเมนท์", f"สร้างเมื่อ {meta['generated']}", ""]
    rep += log + [""]
    rep.append("## ตรวจสอบรายสเตทเมนท์")
    rep.append("| ไฟล์ | หน้า | รอบ | ฝากเข้า (อ่านได้) | หัวกระดาษ | ถอน (อ่านได้) | หัวกระดาษ | ผล |")
    rep.append("|---|---|---|---|---|---|---|---|")
    for st in statements:
        if st.get("unreadable"):
            rep.append(f"| {st['file']} | {st['page']} | — | — | — | — | — | ⚠ อ่านไม่ได้ (รูปภาพ ยังไม่ถอด) |"); continue
        per = f"{st['period'][0]} - {st['period'][1]}" if st.get("period") else "(ต่อจากหน้าก่อน)"
        ti = f"{st['tot_in'][0]} รายการ {fmt(st['tot_in'][1])}" if st.get("tot_in") else "—"
        to = f"{st['tot_out'][0]} รายการ {fmt(st['tot_out'][1])}" if st.get("tot_out") else "—"
        ok = "✓ ตรง" if not st["errors"] else "⚠ " + " · ".join(st["errors"])
        rep.append(f"| {st['file']} | {st['page']} | {per} | {st['n_in']} รายการ {fmt(st['sum_in'])} | {ti} | {st['n_out']} รายการ {fmt(st['sum_out'])} | {to} | {ok} |")
    rep += ["", "## สรุปรายคน (เงินเข้า)", "", "| # | ผู้โอน | บัญชี | เลขสมาชิก(เดา) | ครั้ง | รวม | ครั้งแรก | ล่าสุด |", "|---|---|---|---|---|---|---|---|"]
    for i, p in enumerate(persons, 1):
        rep.append(f"| {i} | {p['name']} | {p['key']} | {p['member_no'] or '—'} | {p['count']} | {fmt(p['total'])} | {p['first']} | {p['last']} |")
    with io.open(os.path.join(OUT_DIR, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(rep) + "\n")
    # แดชบอร์ด
    if os.path.exists(TEMPLATE):
        with io.open(TEMPLATE, encoding="utf-8") as f: html = f.read()
        data = json.dumps({"meta": meta, "persons": persons,
                           "tx": [{k: r[k] for k in ("date","time","kind","in","amount","balance","channel","bank","account","name","member_no","member_name","period","month","file","page")}
                                  | {"suspect": bool(r.get("suspect")), "ref": r.get("ref",""), "payer": r.get("payer","")} for r in txs]},
                          ensure_ascii=False).replace("</", "<\\/")
        html = html.replace("/*__DATA__*/null", data)
        with io.open(os.path.join(OUT_DIR, "dashboard.html"), "w", encoding="utf-8") as f: f.write(html)

def main():
    ap = argparse.ArgumentParser(description="อ่านสเตทเมนท์ PDF ของ กบข.นข.")
    ap.add_argument("pdfs", nargs="*", help="ไฟล์ PDF (ว่าง = ทุกไฟล์ในโฟลเดอร์โปรเจกต์)")
    ap.add_argument("--members", help="ไฟล์ JSON สำรองจากโปรแกรม (kbk-*.json) เพื่อใส่ชื่อสมาชิก")
    ap.add_argument("--no-ai", action="store_true", help="ไม่เรียก AI แม้มีกุญแจ")
    ap.add_argument("--root", help="โฟลเดอร์ที่เก็บไฟล์ PDF (ค่าเริ่มต้น = โฟลเดอร์เหนือ tools/)")
    ap.add_argument("--out", help="โฟลเดอร์ผลลัพธ์ (ค่าเริ่มต้น = <root>/out)")
    ap.add_argument("--ocr-dir", help="โฟลเดอร์เก็บข้อความที่ถอดจากหน้ารูปภาพ (ค่าเริ่มต้น = tools/ocr)")
    a = ap.parse_args()
    global ROOT, OUT_DIR, OCR_DIR
    if a.root:    ROOT    = os.path.abspath(a.root)
    if a.out:     OUT_DIR = os.path.abspath(a.out)
    elif a.root:  OUT_DIR = os.path.join(ROOT, "out")
    if a.ocr_dir: OCR_DIR = os.path.abspath(a.ocr_dir)
    pdfs = a.pdfs or sorted(glob.glob(os.path.join(ROOT, "*.pdf")))
    allow_ai = bool(os.environ.get("ANTHROPIC_API_KEY")) and not a.no_ai
    log, statements = [], []
    for p in pdfs:
        statements += read_pdf(p, allow_ai, log)
    for st in statements:
        if not st.get("unreadable"): validate(st)
    txs, persons = build(statements, load_members(a.members))
    write_outputs(statements, txs, persons, log)
    sys.stdout.reconfigure(encoding="utf-8")
    print("\n".join(log))
    print(f"\nรายการไม่ซ้ำ {len(txs)} · ผู้โอน {len(persons)} คน · ผลอยู่ที่ {os.path.relpath(OUT_DIR, os.getcwd())}/")
    bad = [st for st in statements if st.get("errors") or st.get("unreadable")]
    for st in bad:
        print(f"⚠ {st['file']} หน้า {st['page']}: " + ("อ่านไม่ได้" if st.get("unreadable") else " | ".join(st["errors"])))
    if not bad: print("✓ ทุกสเตทเมนท์ตรงกับหัวกระดาษและยอดคงเหลือต่อกันครบทุกบรรทัด")

if __name__ == "__main__":
    main()
