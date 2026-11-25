// ====================================================================
// DUYỆT ĐÓNG GÓP + BẢO VỆ TỪ ĐIỂN  (dán vào Apps Script của file Data_Từ Điển)
// --------------------------------------------------------------------
// Dùng chung project với file "dong-bo-am-thanh-github.gs".
//
// PHẦN 1 - DUYỆT ĐÓNG GÓP (sheet "Data_Đóng góp Từ vựng", tab TuVung)
//   Menu "Duyệt đóng góp":
//   - Kiểm tra đóng góp: so từng đóng góp với Tu_Dien, ghi kết quả vào
//     cột F (Kiểm tra), thêm ô tích ở cột G (Duyệt).
//   - Chuyển các dòng đã duyệt: dòng nào tích G và chưa có cột H (Kết quả)
//     thì chuyển sang Tu_Dien (thêm mới hoặc gắn âm thanh), rồi hỏi có đẩy
//     âm thanh lên GitHub không.
//   Quy tắc trùng: cùng tiếng Việt VÀ cùng tiếng Xơ Đăng (không phân biệt
//   hoa/thường, khoảng trắng thừa, kiểu gõ dấu) thì là trùng.
//
// PHẦN 2 - BẢO VỆ TU_DIEN
//   Menu "Bảo vệ từ điển":
//   - Đặt / đổi mật khẩu xóa.
//   - Xóa dòng đang chọn (cần mật khẩu): chuyển dòng sang sheet Thung_Rac.
//   - Khôi phục từ thùng rác.
//   - Bật bảo vệ: nếu ai xóa dòng (hoặc xóa trắng cả dòng) trực tiếp trong
//     Tu_Dien, script tự khôi phục lại đúng vị trí và ghi nhật ký.
//   - Cảnh báo ngay khi nhập một từ đã có trong từ điển.
// ====================================================================

var DG = {
  CONTRIB_SPREADSHEET_ID: '18XkQNeaE5NlTXSWdpeb3ksTlMyebI11a3szgyX_Puoo',
  CONTRIB_SHEET: 'TuVung',
  DICT_SHEET: 'Tu_Dien',
  SNAPSHOT_SHEET: '_BanSao_TuDien',
  TRASH_SHEET: 'Thung_Rac',
  LOG_SHEET: 'Nhat_Ky_Bao_Ve',
  DICT_COLS: 7,         // A..G của Tu_Dien
  // Cột trong tab TuVung (bắt đầu từ 1)
  C_VIET: 2, C_XD: 3, C_LINK: 4, C_ID: 5, C_CHECK: 6, C_APPROVE: 7, C_RESULT: 8
};

// ==================== MENU (gộp cả menu Âm thanh GitHub) ====================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  if (typeof taoMenuGitHub_ === 'function') taoMenuGitHub_(ui);
  ui.createMenu('Duyệt đóng góp')
    .addItem('1. Kiểm tra đóng góp', 'kiemTraDongGop')
    .addItem('2. Chuyển các dòng đã duyệt sang từ điển', 'chuyenDongDaDuyet')
    .addSeparator()
    .addItem('Mở sheet đóng góp', 'moSheetDongGop')
    .addToUi();
  ui.createMenu('Bảo vệ từ điển')
    .addItem('Xóa dòng đang chọn (cần mật khẩu)', 'xoaDongCoMatKhau')
    .addItem('Khôi phục dòng đang chọn trong Thung_Rac', 'khoiPhucTuThungRac')
    .addSeparator()
    .addItem('Đặt / đổi mật khẩu xóa', 'datMatKhauXoa')
    .addItem('Bật bảo vệ (tự khôi phục khi bị xóa)', 'batBaoVe')
    .addItem('Tắt bảo vệ (cần mật khẩu)', 'tatBaoVe')
    .addItem('Tìm từ trùng trong từ điển', 'timTuTrung')
    .addToUi();
}

// ==================== TIỆN ÍCH CHUNG ====================
function chuanHoa_(s) {
  return String(s == null ? '' : s).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function layIdTuLink_(link, fallback) {
  var s = String(link || '');
  var m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  var f = String(fallback || '').trim();
  return /^[A-Za-z0-9_-]{20,}$/.test(f) ? f : '';
}

function thongBao_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function sheetTuDien_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DG.DICT_SHEET);
  if (!sh) throw new Error('Không tìm thấy sheet "' + DG.DICT_SHEET + '"');
  return sh;
}

// Đọc Tu_Dien thành chỉ mục: theo tiếng Việt, theo cặp Việt|Xơ Đăng, theo ID âm thanh
function docTuDien_() {
  var sh = sheetTuDien_();
  var last = sh.getLastRow();
  var values = last >= 2 ? sh.getRange(2, 1, last - 1, DG.DICT_COLS).getValues() : [];
  var byViet = {}, byPair = {}, byId = {};
  values.forEach(function (r, i) {
    var row = i + 2;
    var v = chuanHoa_(r[0]), x = chuanHoa_(r[1]), id = String(r[3] || '').trim();
    var info = { row: row, viet: r[0], xd: r[1], id: id };
    if (v) (byViet[v] = byViet[v] || []).push(info);
    if (v && x) byPair[v + '|' + x] = info;
    if (id) byId[id] = info;
  });
  return { sheet: sh, byViet: byViet, byPair: byPair, byId: byId };
}

// ==================== PHẦN 1: DUYỆT ĐÓNG GÓP ====================
function sheetDongGop_() {
  var ss = SpreadsheetApp.openById(DG.CONTRIB_SPREADSHEET_ID);
  var sh = ss.getSheetByName(DG.CONTRIB_SHEET);
  if (!sh) throw new Error('Không tìm thấy tab "' + DG.CONTRIB_SHEET + '" trong file đóng góp');
  return sh;
}

function moSheetDongGop() {
  var url = 'https://docs.google.com/spreadsheets/d/' + DG.CONTRIB_SPREADSHEET_ID + '/edit';
  var html = HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">Mở sheet đóng góp: <a href="' + url + '" target="_blank">bấm vào đây</a></p>'
  ).setWidth(320).setHeight(80);
  SpreadsheetApp.getUi().showModalDialog(html, 'Sheet đóng góp');
}

// Phân loại một đóng góp so với từ điển hiện tại
function phanLoai_(viet, xd, id, dict) {
  var v = chuanHoa_(viet), x = chuanHoa_(xd);
  if (!v || !x) return { code: 'THIEU', text: '⚠ Thiếu tiếng Việt hoặc tiếng Xơ Đăng' };

  var exact = dict.byPair[v + '|' + x];
  if (exact) {
    if (!exact.id && id) {
      return { code: 'GAN_AM', row: exact.row,
        text: '🔇 Đã có ở dòng ' + exact.row + ' nhưng CHƯA có âm thanh → duyệt sẽ gắn âm thanh này' };
    }
    return { code: 'TRUNG', row: exact.row,
      text: '🔁 Trùng: đã có ở dòng ' + exact.row + (exact.id ? ' (đã có âm thanh)' : '') + ' → không cần thêm' };
  }

  if (id && dict.byId[id]) {
    return { code: 'TRUNG_AM', row: dict.byId[id].row,
      text: '⚠ File âm thanh này đã dùng cho dòng ' + dict.byId[id].row + ' (' + dict.byId[id].viet + ')' };
  }

  var sameViet = dict.byViet[v];
  var note = id ? '' : ' (chưa có âm thanh)';
  if (sameViet && sameViet.length) {
    var others = sameViet.map(function (o) { return '"' + o.xd + '" (dòng ' + o.row + ')'; }).join(', ');
    return { code: 'MOI', text: '🆕 Từ Việt đã có nhưng khác chữ Xơ Đăng: ' + others + ' → duyệt sẽ thêm dòng mới' + note };
  }
  return { code: 'MOI', text: '🆕 Từ mới → duyệt sẽ thêm vào từ điển' + note };
}

function chuanBiCotDongGop_(sh, lastRow) {
  sh.getRange(1, DG.C_CHECK, 1, 3).setValues([['Kiểm tra', 'Duyệt', 'Kết quả']])
    .setFontWeight('bold').setBackground('#fff2cc');
  if (lastRow >= 2) {
    sh.getRange(2, DG.C_APPROVE, lastRow - 1, 1).insertCheckboxes();
  }
}

function kiemTraDongGop() {
  var sh = sheetDongGop_();
  var last = sh.getLastRow();
  chuanBiCotDongGop_(sh, last);
  if (last < 2) { thongBao_('Chưa có đóng góp nào.'); return; }

  var data = sh.getRange(2, 1, last - 1, DG.C_RESULT).getValues();
  var dict = docTuDien_();
  var seen = {};
  var out = [], colors = [];
  var dem = { MOI: 0, GAN_AM: 0, TRUNG: 0, KHAC: 0, DA_XU_LY: 0 };

  data.forEach(function (r, i) {
    var row = i + 2;
    var viet = r[DG.C_VIET - 1], xd = r[DG.C_XD - 1];
    var id = layIdTuLink_(r[DG.C_LINK - 1], r[DG.C_ID - 1]);
    var daXuLy = String(r[DG.C_RESULT - 1] || '').trim();

    if (!chuanHoa_(viet) && !chuanHoa_(xd) && !id) { out.push(['']); colors.push([null]); return; }
    if (daXuLy) { dem.DA_XU_LY++; out.push([r[DG.C_CHECK - 1]]); colors.push(['#eeeeee']); return; }

    var kq = phanLoai_(viet, xd, id, dict);
    var key = chuanHoa_(viet) + '|' + chuanHoa_(xd);
    if (seen[key] && kq.code !== 'THIEU') kq.text += ' · 👥 Trùng với đóng góp dòng ' + seen[key];
    else seen[key] = row;

    if (dem[kq.code] !== undefined) dem[kq.code]++; else dem.KHAC++;
    out.push([kq.text]);
    colors.push([{ MOI: '#d9ead3', GAN_AM: '#cfe2f3', TRUNG: '#f4cccc' }[kq.code] || '#fce5cd']);
  });

  sh.getRange(2, DG.C_CHECK, out.length, 1).setValues(out).setBackgrounds(colors).setWrap(true);
  thongBao_(
    '🔎 ĐÃ KIỂM TRA ' + (data.length) + ' DÒNG ĐÓNG GÓP\n\n' +
    '🆕 Từ mới / cách viết mới: ' + dem.MOI + '\n' +
    '🔇 Gắn âm thanh cho từ đã có: ' + dem.GAN_AM + '\n' +
    '🔁 Trùng (không cần thêm): ' + dem.TRUNG + '\n' +
    '⚠ Cần xem lại: ' + dem.KHAC + '\n' +
    '✔ Đã xử lý từ trước: ' + dem.DA_XU_LY + '\n\n' +
    '👉 Mở sheet đóng góp, tích cột G (Duyệt) cho các dòng đúng, rồi chọn\n' +
    '"Duyệt đóng góp → 2. Chuyển các dòng đã duyệt sang từ điển".'
  );
}

function chuyenDongDaDuyet() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { thongBao_('⏳ Đang có thao tác khác chạy, thử lại sau.'); return; }
  try {
    var sh = sheetDongGop_();
    var last = sh.getLastRow();
    if (last < 2) { thongBao_('Chưa có đóng góp nào.'); return; }

    var data = sh.getRange(2, 1, last - 1, DG.C_RESULT).getValues();
    var dict = docTuDien_();
    var dictSheet = dict.sheet;
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    var themMoi = 0, ganAm = 0, boQua = 0, coAmMoi = 0;
    var results = [];

    data.forEach(function (r, i) {
      var row = i + 2;
      var cur = String(r[DG.C_RESULT - 1] || '');
      if (r[DG.C_APPROVE - 1] !== true || cur.trim()) { results.push([cur]); return; }

      var viet = String(r[DG.C_VIET - 1] || '').trim();
      var xd = String(r[DG.C_XD - 1] || '').trim();
      var id = layIdTuLink_(r[DG.C_LINK - 1], r[DG.C_ID - 1]);
      var kq = phanLoai_(viet, xd, id, dict); // kiểm tra lại ngay lúc chuyển

      if (kq.code === 'MOI') {
        var newRow = dictSheet.getLastRow() + 1;
        var rowValues = [viet, xd, '', id, '', '', ''];
        dictSheet.getRange(newRow, 1, 1, DG.DICT_COLS).setValues([rowValues]);
        var info = { row: newRow, viet: viet, xd: xd, id: id };
        var v = chuanHoa_(viet);
        (dict.byViet[v] = dict.byViet[v] || []).push(info);
        dict.byPair[v + '|' + chuanHoa_(xd)] = info;
        if (id) { dict.byId[id] = info; coAmMoi++; }
        themMoi++;
        results.push(['✅ Đã thêm → dòng ' + newRow + ' (' + now + ')']);
      } else if (kq.code === 'GAN_AM') {
        dictSheet.getRange(kq.row, 4).setValue(id);
        dict.byPair[chuanHoa_(viet) + '|' + chuanHoa_(xd)].id = id;
        dict.byId[id] = dict.byPair[chuanHoa_(viet) + '|' + chuanHoa_(xd)];
        ganAm++; coAmMoi++;
        results.push(['✅ Đã gắn âm thanh → dòng ' + kq.row + ' (' + now + ')']);
      } else {
        boQua++;
        results.push(['⏩ Không chuyển: ' + kq.text.replace(/^[^ ]+ /, '') + ' (' + now + ')']);
      }
    });

    sh.getRange(2, DG.C_RESULT, results.length, 1).setValues(results).setWrap(true);
    if (themMoi || ganAm) capNhatBanSao_(); // script sửa Tu_Dien -> cập nhật bản sao bảo vệ

    var msg = '📥 ĐÃ CHUYỂN SANG TỪ ĐIỂN\n\n' +
      '🆕 Thêm mới: ' + themMoi + '\n' +
      '🔇 Gắn âm thanh: ' + ganAm + '\n' +
      '⏩ Không chuyển (trùng / thiếu dữ liệu): ' + boQua;
    if (!themMoi && !ganAm && !boQua) msg = 'Không có dòng nào được tích Duyệt (cột G) mà chưa xử lý.';

    if (coAmMoi && typeof syncAudioToGitHub === 'function') {
      var ui = SpreadsheetApp.getUi();
      var ans = ui.alert(msg + '\n\nCó ' + coAmMoi + ' âm thanh mới. Đẩy lên GitHub ngay?', ui.ButtonSet.YES_NO);
      if (ans === ui.Button.YES) syncAudioToGitHub();
    } else {
      thongBao_(msg);
    }
  } finally {
    lock.releaseLock();
  }
}

// ==================== PHẦN 2: BẢO VỆ TU_DIEN ====================
function bamMatKhau_(pw) {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('DELETE_PW_SALT');
  if (!salt) { salt = Utilities.getUuid(); props.setProperty('DELETE_PW_SALT', salt); }
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function kiemTraMatKhau_(tieuDe) {
  var hash = PropertiesService.getScriptProperties().getProperty('DELETE_PW_HASH');
  var ui = SpreadsheetApp.getUi();
  if (!hash) { ui.alert('Chưa đặt mật khẩu. Vào "Bảo vệ từ điển → Đặt / đổi mật khẩu xóa".'); return false; }
  var res = ui.prompt(tieuDe, 'Nhập mật khẩu:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return false;
  if (bamMatKhau_(res.getResponseText()) !== hash) { ui.alert('❌ Sai mật khẩu.'); return false; }
  return true;
}

function datMatKhauXoa() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DELETE_PW_HASH') && !kiemTraMatKhau_('Xác nhận mật khẩu CŨ')) return;
  var a = ui.prompt('Mật khẩu xóa mới', 'Nhập mật khẩu mới (ít nhất 6 ký tự):', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var pw = a.getResponseText();
  if (pw.length < 6) { ui.alert('Mật khẩu cần ít nhất 6 ký tự.'); return; }
  var b = ui.prompt('Mật khẩu xóa mới', 'Nhập lại mật khẩu:', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  if (b.getResponseText() !== pw) { ui.alert('Hai lần nhập không khớp.'); return; }
  props.setProperty('DELETE_PW_HASH', bamMatKhau_(pw));
  ui.alert('✅ Đã lưu mật khẩu xóa.');
}

// Khóa nhận diện một dòng: ưu tiên ID âm thanh, nếu không có thì Việt|Xơ Đăng
function khoaDong_(r) {
  var id = String(r[3] || '').trim();
  if (id) return 'id:' + id;
  var v = chuanHoa_(r[0]), x = chuanHoa_(r[1]);
  return (v || x) ? 'w:' + v + '|' + x : '';
}

function laDongTrong_(r) {
  for (var i = 0; i < 4; i++) if (String(r[i] || '').trim()) return false;
  return true;
}

function sheetPhu_(name, header, hidden) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (header) sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    if (hidden) sh.hideSheet();
  }
  return sh;
}

// Lưu bản sao Tu_Dien (số dòng + 7 cột) vào sheet ẩn để so sánh khi có thay đổi
function capNhatBanSao_() {
  var dict = sheetTuDien_();
  var last = dict.getLastRow();
  var values = last >= 2 ? dict.getRange(2, 1, last - 1, DG.DICT_COLS).getValues() : [];
  var rows = [];
  values.forEach(function (r, i) { if (khoaDong_(r)) rows.push([i + 2].concat(r)); });
  var snap = sheetPhu_(DG.SNAPSHOT_SHEET, null, true);
  snap.clearContents();
  if (rows.length) snap.getRange(1, 1, rows.length, DG.DICT_COLS + 1).setValues(rows);
}

function ghiNhatKy_(hanhDong, rows) {
  var log = sheetPhu_(DG.LOG_SHEET, ['Thời gian', 'Người thao tác', 'Hành động', 'Dòng', 'Tiếng Việt', 'Tiếng Xơ Đăng', 'ID âm thanh']);
  var who = '';
  try { who = Session.getActiveUser().getEmail(); } catch (e) {}
  var now = new Date();
  var out = rows.map(function (r) { return [now, who, hanhDong, r.row, r.values[0], r.values[1], r.values[3]]; });
  if (out.length) log.getRange(log.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
}

// Trigger onChange: phát hiện dòng bị xóa trực tiếp và tự khôi phục
function baoVeKhiThayDoi(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var snap = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DG.SNAPSHOT_SHEET);
    if (!snap || snap.getLastRow() < 1) { capNhatBanSao_(); return; }

    var dict = sheetTuDien_();
    var last = dict.getLastRow();
    var cur = last >= 2 ? dict.getRange(2, 1, last - 1, DG.DICT_COLS).getValues() : [];
    var curKeys = {};
    var curCount = 0;
    cur.forEach(function (r) { var k = khoaDong_(r); if (k) { curKeys[k] = (curKeys[k] || 0) + 1; curCount++; } });

    var snapRows = snap.getRange(1, 1, snap.getLastRow(), DG.DICT_COLS + 1).getValues();
    var thieu = curCount < snapRows.length ? snapRows.length - curCount : 0;
    if (!thieu) { capNhatBanSao_(); return; } // thêm/sửa/sắp xếp bình thường

    var missing = [];
    snapRows.forEach(function (s) {
      var vals = s.slice(1);
      var k = khoaDong_(vals);
      if (!k) return;
      if (curKeys[k]) curKeys[k]--; else missing.push({ row: Number(s[0]), values: vals });
    });
    missing = missing.slice(0, thieu).sort(function (a, b) { return a.row - b.row; });

    missing.forEach(function (m) {
      var lastNow = dict.getLastRow();
      var target = Math.max(2, m.row);
      if (target <= lastNow && laDongTrong_(dict.getRange(target, 1, 1, DG.DICT_COLS).getValues()[0])) {
        dict.getRange(target, 1, 1, DG.DICT_COLS).setValues([m.values]);   // dòng bị xóa trắng
      } else if (target <= lastNow) {
        dict.insertRowBefore(target);                                      // dòng bị xóa hẳn
        dict.getRange(target, 1, 1, DG.DICT_COLS).setValues([m.values]);
      } else {
        dict.getRange(lastNow + 1, 1, 1, DG.DICT_COLS).setValues([m.values]);
      }
    });

    if (missing.length) {
      ghiNhatKy_('Tự khôi phục (xóa không qua mật khẩu)', missing);
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Đã khôi phục ' + missing.length + ' dòng vừa bị xóa. Muốn xóa, dùng menu "Bảo vệ từ điển → Xóa dòng đang chọn (cần mật khẩu)".',
        '🛡 Bảo vệ từ điển', 10);
    }
    capNhatBanSao_();
  } finally {
    lock.releaseLock();
  }
}

function batBaoVe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'baoVeKhiThayDoi'; });
  if (!exists) ScriptApp.newTrigger('baoVeKhiThayDoi').forSpreadsheet(ss).onChange().create();
  capNhatBanSao_();
  var coMk = !!PropertiesService.getScriptProperties().getProperty('DELETE_PW_HASH');
  thongBao_('🛡 Đã bật bảo vệ từ điển.\n\nNếu ai xóa dòng trực tiếp trong Tu_Dien, script sẽ tự khôi phục và ghi vào sheet "' +
    DG.LOG_SHEET + '".' + (coMk ? '' : '\n\n⚠ Bạn chưa đặt mật khẩu xóa: vào "Đặt / đổi mật khẩu xóa".'));
}

function tatBaoVe() {
  if (!kiemTraMatKhau_('Tắt bảo vệ từ điển')) return;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'baoVeKhiThayDoi') ScriptApp.deleteTrigger(t);
  });
  thongBao_('Đã tắt bảo vệ. Xóa dòng sẽ không được tự khôi phục nữa.');
}

function xoaDongCoMatKhau() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getActiveSheet();
  if (sh.getName() !== DG.DICT_SHEET) { thongBao_('Hãy chọn các dòng cần xóa trong sheet ' + DG.DICT_SHEET + '.'); return; }
  var ranges = ss.getActiveRangeList() ? ss.getActiveRangeList().getRanges() : [sh.getActiveRange()];
  var rowsSet = {};
  ranges.forEach(function (rg) {
    for (var r = rg.getRow(); r < rg.getRow() + rg.getNumRows(); r++) if (r >= 2) rowsSet[r] = true;
  });
  var rows = Object.keys(rowsSet).map(Number).sort(function (a, b) { return a - b; });
  if (!rows.length) { thongBao_('Chưa chọn dòng nào (không xóa được dòng tiêu đề).'); return; }

  var items = rows.map(function (r) { return { row: r, values: sh.getRange(r, 1, 1, DG.DICT_COLS).getValues()[0] }; });
  var preview = items.slice(0, 8).map(function (it) { return 'Dòng ' + it.row + ': ' + it.values[0] + ' → ' + it.values[1]; }).join('\n');
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Xóa ' + rows.length + ' dòng?', preview + (rows.length > 8 ? '\n…' : '') +
      '\n\nCác dòng sẽ được chuyển vào sheet ' + DG.TRASH_SHEET + ' (có thể khôi phục).', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  if (!kiemTraMatKhau_('Xóa ' + rows.length + ' dòng khỏi từ điển')) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var trash = sheetPhu_(DG.TRASH_SHEET, ['Thời gian xóa', 'Người xóa', 'Dòng cũ', 'Tiếng việt', 'Tiếng Xơ Đăng', 'Cách đọc',
      'ID âm thanh', 'Ví dụ Việt', 'Ví dụ Xơ Đăng', 'Chủ đề']);
    var who = '';
    try { who = Session.getActiveUser().getEmail(); } catch (e) {}
    var now = new Date();
    trash.getRange(trash.getLastRow() + 1, 1, items.length, 3 + DG.DICT_COLS)
      .setValues(items.map(function (it) { return [now, who, it.row].concat(it.values); }));
    for (var i = rows.length - 1; i >= 0; i--) sh.deleteRow(rows[i]);
    ghiNhatKy_('Xóa có mật khẩu', items);
    capNhatBanSao_();
  } finally {
    lock.releaseLock();
  }
  thongBao_('🗑 Đã xóa ' + rows.length + ' dòng và lưu vào sheet ' + DG.TRASH_SHEET + '.');
}

function khoiPhucTuThungRac() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getActiveSheet();
  if (sh.getName() !== DG.TRASH_SHEET) { thongBao_('Hãy mở sheet ' + DG.TRASH_SHEET + ' và chọn các dòng cần khôi phục.'); return; }
  var rg = sh.getActiveRange();
  var rows = [];
  for (var r = rg.getRow(); r < rg.getRow() + rg.getNumRows(); r++) if (r >= 2) rows.push(r);
  if (!rows.length) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var dict = sheetTuDien_();
    var restored = [];
    rows.forEach(function (r) {
      var vals = sh.getRange(r, 4, 1, DG.DICT_COLS).getValues()[0];
      if (laDongTrong_(vals)) return;
      var target = dict.getLastRow() + 1;
      dict.getRange(target, 1, 1, DG.DICT_COLS).setValues([vals]);
      restored.push({ row: target, values: vals });
    });
    for (var i = rows.length - 1; i >= 0; i--) sh.deleteRow(rows[i]);
    ghiNhatKy_('Khôi phục từ thùng rác', restored);
    capNhatBanSao_();
    thongBao_('♻ Đã khôi phục ' + restored.length + ' dòng về cuối sheet ' + DG.DICT_SHEET + '.');
  } finally {
    lock.releaseLock();
  }
}

// Cảnh báo ngay khi nhập một từ đã có (trigger đơn giản, không cần cài)
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== DG.DICT_SHEET || e.range.getRow() < 2 || e.range.getColumn() > 2) return;
  if (e.range.getNumRows() > 1) return;
  var row = e.range.getRow();
  var vals = sh.getRange(row, 1, 1, 2).getValues()[0];
  var v = chuanHoa_(vals[0]), x = chuanHoa_(vals[1]);
  if (!v) return;
  var last = sh.getLastRow();
  var all = sh.getRange(2, 1, last - 1, 2).getValues();
  var same = [];
  all.forEach(function (r, i) {
    if (i + 2 !== row && chuanHoa_(r[0]) === v) same.push({ row: i + 2, xd: r[1], dup: x && chuanHoa_(r[1]) === x });
  });
  if (!same.length) return;
  var dup = same.filter(function (s) { return s.dup; });
  var msg = dup.length
    ? 'Từ "' + vals[0] + ' → ' + vals[1] + '" ĐÃ CÓ ở dòng ' + dup.map(function (s) { return s.row; }).join(', ')
    : 'Từ Việt "' + vals[0] + '" đã có: ' + same.map(function (s) { return '"' + s.xd + '" (dòng ' + s.row + ')'; }).join(', ');
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, dup.length ? '⚠ Trùng từ' : 'ℹ Từ đã có', 8);
}

function timTuTrung() {
  var dict = docTuDien_();
  var lines = [];
  Object.keys(dict.byViet).forEach(function (v) {
    var list = dict.byViet[v];
    if (list.length > 1) {
      lines.push('• ' + list[0].viet + ': ' + list.map(function (o) { return 'dòng ' + o.row + ' "' + o.xd + '"'; }).join(', '));
    }
  });
  thongBao_(lines.length ? '🔎 CÁC TỪ VIỆT XUẤT HIỆN NHIỀU LẦN (' + lines.length + ')\n\n' + lines.slice(0, 40).join('\n')
    : '✅ Không có từ trùng.');
}
