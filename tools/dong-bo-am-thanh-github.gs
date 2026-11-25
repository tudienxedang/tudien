// ====================================================================
// ĐỒNG BỘ ÂM THANH: GOOGLE SHEET/DRIVE  ->  GITHUB (thư mục audio/)
// --------------------------------------------------------------------
// Thay cho quy trình cũ (copy vào GitHub_Audio_Export -> tải về -> upload).
// Script đọc Drive ID ở cột D của sheet "Tu_Dien", so với các file đang có
// trong thư mục audio/ trên GitHub, rồi đẩy CHỈ CÁC FILE MỚI lên trong
// MỘT commit duy nhất. GitHub Pages tự cập nhật website sau ~1-2 phút.
//
// CÀI ĐẶT (làm 1 lần):
// 1. GitHub -> Settings -> Developer settings -> Fine-grained tokens ->
//    Generate new token:
//      - Repository access: Only select repositories -> tudienxedang/tudien
//      - Permissions -> Repository -> Contents: Read and write
// 2. Trong Google Sheet: Extensions -> Apps Script -> tạo file mới, dán
//    toàn bộ nội dung này vào, bấm Lưu.
// 3. Tải lại Google Sheet -> menu "Âm thanh GitHub" -> "Cài token GitHub"
//    -> dán token. Token được lưu trong Script Properties, không nằm trong
//    code hay trong Sheet.
// 4. Menu "Âm thanh GitHub" -> "Đẩy âm thanh mới lên GitHub".
//    (Tùy chọn) "Bật tự động đồng bộ mỗi đêm".
//
// Lưu ý: ai có quyền sửa Apps Script của file này đều dùng được token,
// chỉ chia sẻ quyền chỉnh sửa cho người tin cậy.
// ====================================================================

var GH = {
  OWNER: 'tudienxedang',
  REPO: 'tudien',
  BRANCH: 'main',
  AUDIO_DIR: 'audio',
  SHEET_NAME: 'Tu_Dien',
  ID_COLUMN: 4,               // cột D
  MAX_FILES_PER_RUN: 200,     // giới hạn mỗi lần chạy, chạy lại để đẩy tiếp
  MAX_RUNTIME_MS: 4.5 * 60 * 1000, // Apps Script giới hạn 6 phút/lần
  PARALLEL: 10                // số file tải lên GitHub song song
};

// Website luôn tìm file <ID>.webm, nên chỉ đẩy file đúng định dạng WebM.
// Nhận diện theo loại file trên Drive HOẶC theo 4 byte đầu của WebM (1A 45 DF A3),
// vì file thu âm đôi khi được Drive lưu là "application/octet-stream".
function isWebm_(blob, type) {
  if (type.indexOf('webm') !== -1) return true;
  var b = blob.getBytes();
  return b.length > 4 && (b[0] & 0xff) === 0x1a && (b[1] & 0xff) === 0x45 &&
    (b[2] & 0xff) === 0xdf && (b[3] & 0xff) === 0xa3;
}

// ==================== MENU ====================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Âm thanh GitHub')
    .addItem('Đẩy âm thanh mới lên GitHub', 'syncAudioToGitHub')
    .addItem('Kiểm tra (không đẩy)', 'checkAudioOnGitHub')
    .addSeparator()
    .addItem('Cài token GitHub', 'setGitHubToken')
    .addItem('Bật tự động đồng bộ mỗi đêm', 'enableNightlySync')
    .addItem('Tắt tự động đồng bộ', 'disableNightlySync')
    .addToUi();
}

function setGitHubToken() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Cài token GitHub',
    'Dán fine-grained token (quyền Contents: Read and write cho repo ' +
    GH.OWNER + '/' + GH.REPO + '):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var token = res.getResponseText().trim();
  if (!token) return;
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', token);
  try {
    var repo = ghRequest_('GET', '/repos/' + GH.OWNER + '/' + GH.REPO);
    ui.alert('✅ Đã lưu token. Kết nối được repo: ' + repo.full_name);
  } catch (e) {
    ui.alert('⚠️ Đã lưu token nhưng chưa kết nối được repo:\n' + e.message);
  }
}

function enableNightlySync() {
  disableNightlySync();
  ScriptApp.newTrigger('syncAudioToGitHub').timeBased().everyDays(1).atHour(1).create();
  notify_('✅ Đã bật tự động đồng bộ lúc ~1 giờ sáng mỗi ngày.');
}

function disableNightlySync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncAudioToGitHub') ScriptApp.deleteTrigger(t);
  });
}

// ==================== CHẠY CHÍNH ====================
function checkAudioOnGitHub() {
  var plan = buildPlan_();
  notify_(
    '🔎 KIỂM TRA (chưa đẩy gì)\n\n' +
    '✔ Đã có trên GitHub: ' + plan.existingCount + ' file\n' +
    '🆕 Cần đẩy lên: ' + plan.missing.length + ' file\n' +
    '⏩ Dòng chưa có ID: ' + plan.noIdCount + '\n' +
    '⚠️ ID không hợp lệ: ' + plan.invalid.length +
    (plan.invalid.length ? '\n   ' + plan.invalid.slice(0, 5).join('\n   ') : '')
  );
}

function syncAudioToGitHub() {
  var start = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    notify_('⏳ Đang có một lần đồng bộ khác chạy, vui lòng thử lại sau.');
    return;
  }

  try {
    var plan = buildPlan_();
    var todo = plan.missing.slice(0, GH.MAX_FILES_PER_RUN);
    var uploaded = [];   // {path, sha}
    var errors = [];
    var skippedFormat = [];
    var stoppedEarly = false;

    // Tải từng nhóm file từ Drive rồi tạo blob trên GitHub (song song)
    for (var i = 0; i < todo.length; i += GH.PARALLEL) {
      if (Date.now() - start > GH.MAX_RUNTIME_MS) { stoppedEarly = true; break; }
      var group = todo.slice(i, i + GH.PARALLEL);
      var requests = [];
      var groupItems = [];

      group.forEach(function (it) {
        try {
          var blob = DriveApp.getFileById(it.id).getBlob();
          var type = (blob.getContentType() || '').toLowerCase();
          if (!isWebm_(blob, type)) {
            skippedFormat.push('Dòng ' + it.row + ', ' + it.id + ' (' + (type || 'không rõ') + ')');
            return;
          }
          requests.push(ghFetchRequest_('POST', '/repos/' + GH.OWNER + '/' + GH.REPO + '/git/blobs', {
            content: Utilities.base64Encode(blob.getBytes()),
            encoding: 'base64'
          }));
          groupItems.push(it);
        } catch (e) {
          errors.push('Dòng ' + it.row + ', ' + it.id + ': ' + e.message);
        }
      });

      if (!requests.length) continue;
      var responses = UrlFetchApp.fetchAll(requests);
      responses.forEach(function (res, k) {
        var it = groupItems[k];
        if (res.getResponseCode() === 201) {
          uploaded.push({ path: GH.AUDIO_DIR + '/' + it.id + '.webm', sha: JSON.parse(res.getContentText()).sha, id: it.id });
        } else {
          errors.push('Dòng ' + it.row + ', ' + it.id + ': GitHub ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 120));
        }
      });
    }

    var commitInfo = '';
    if (uploaded.length) {
      commitInfo = commitFiles_(plan, uploaded);
    }

    var remaining = plan.missing.length - uploaded.length - errors.length - skippedFormat.length;
    var msg =
      (uploaded.length ? '✅ ĐÃ ĐẨY LÊN GITHUB\n' : 'ℹ️ KHÔNG CÓ FILE MỚI ĐỂ ĐẨY\n') +
      (commitInfo ? commitInfo + '\n' : '') + '\n' +
      '📊 THỐNG KÊ:\n' +
      '🆕 Đẩy mới lần này: ' + uploaded.length + ' file\n' +
      '✔ Đã có sẵn trên GitHub: ' + plan.existingCount + ' file\n' +
      '⏩ Dòng chưa có ID: ' + plan.noIdCount + '\n' +
      '⚠️ Sai định dạng (cần .webm): ' + skippedFormat.length + '\n' +
      '❌ Lỗi: ' + errors.length + ' (ID không hợp lệ: ' + plan.invalid.length + ')\n' +
      (remaining > 0 || stoppedEarly ? '\n👉 Còn ' + Math.max(remaining, 0) + ' file chưa đẩy, hãy chạy lại.\n' : '') +
      (uploaded.length ? '\n🌐 Website cập nhật sau khoảng 1-2 phút.' : '');

    var details = skippedFormat.concat(errors, plan.invalid).slice(0, 8);
    if (details.length) msg += '\n\nChi tiết:\n' + details.join('\n');

    notify_(msg);
  } finally {
    lock.releaseLock();
  }
}

// ==================== LẬP KẾ HOẠCH ====================
// Đọc ID trong Sheet + danh sách file audio/ hiện có trên GitHub
function buildPlan_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GH.SHEET_NAME);
  if (!sheet) throw new Error('Không tìm thấy sheet "' + GH.SHEET_NAME + '"');

  var lastRow = sheet.getLastRow();
  var values = lastRow >= 2 ? sheet.getRange(2, GH.ID_COLUMN, lastRow - 1, 1).getValues() : [];

  // Trạng thái nhánh main hiện tại
  var ref = ghRequest_('GET', '/repos/' + GH.OWNER + '/' + GH.REPO + '/git/ref/heads/' + GH.BRANCH);
  var headSha = ref.object.sha;
  var headCommit = ghRequest_('GET', '/repos/' + GH.OWNER + '/' + GH.REPO + '/git/commits/' + headSha);
  var rootTree = ghRequest_('GET', '/repos/' + GH.OWNER + '/' + GH.REPO + '/git/trees/' + headCommit.tree.sha);

  var existing = {};
  var audioEntry = rootTree.tree.filter(function (e) { return e.path === GH.AUDIO_DIR && e.type === 'tree'; })[0];
  if (audioEntry) {
    var audioTree = ghRequest_('GET', '/repos/' + GH.OWNER + '/' + GH.REPO + '/git/trees/' + audioEntry.sha);
    if (audioTree.truncated) throw new Error('Danh sách audio/ quá lớn, GitHub trả về không đầy đủ.');
    audioTree.tree.forEach(function (e) { existing[e.path] = true; });
  }

  var seen = {};
  var missing = [];
  var invalid = [];
  var noIdCount = 0;
  var existingCount = 0;

  values.forEach(function (row, i) {
    var id = String(row[0] || '').trim();
    if (!id || id === 'null' || id === 'undefined') { noIdCount++; return; }
    if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) { invalid.push('Dòng ' + (i + 2) + ': "' + id + '"'); return; }
    if (seen[id]) return;
    seen[id] = true;
    if (existing[id + '.webm']) { existingCount++; return; }
    missing.push({ id: id, row: i + 2 });
  });

  return {
    headSha: headSha,
    baseTreeSha: headCommit.tree.sha,
    missing: missing,
    invalid: invalid,
    noIdCount: noIdCount,
    existingCount: existingCount
  };
}

// ==================== TẠO 1 COMMIT CHO TẤT CẢ FILE MỚI ====================
function commitFiles_(plan, uploaded) {
  var base = '/repos/' + GH.OWNER + '/' + GH.REPO + '/git';
  var tree = ghRequest_('POST', base + '/trees', {
    base_tree: plan.baseTreeSha,
    tree: uploaded.map(function (f) {
      return { path: f.path, mode: '100644', type: 'blob', sha: f.sha };
    })
  });
  var commit = ghRequest_('POST', base + '/commits', {
    message: 'Them ' + uploaded.length + ' file am thanh tu Google Sheet (Apps Script)',
    tree: tree.sha,
    parents: [plan.headSha]
  });
  try {
    ghRequest_('PATCH', base + '/refs/heads/' + GH.BRANCH, { sha: commit.sha, force: false });
  } catch (e) {
    // Nhánh main vừa thay đổi trong lúc chạy (ví dụ có người push code) -> không ghi đè
    throw new Error('Nhánh ' + GH.BRANCH + ' vừa có thay đổi khác trong lúc đồng bộ. ' +
      'Không có gì bị ghi đè, hãy chạy lại. (' + e.message + ')');
  }
  return 'Commit ' + commit.sha.slice(0, 7) + ' trên nhánh ' + GH.BRANCH;
}

// ==================== GITHUB API ====================
function getToken_() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Chưa cài token. Vào menu "Âm thanh GitHub" -> "Cài token GitHub".');
  return token;
}

function ghFetchRequest_(method, path, body) {
  var req = {
    url: 'https://api.github.com' + path,
    method: method.toLowerCase(),
    headers: {
      Authorization: 'Bearer ' + getToken_(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    muteHttpExceptions: true
  };
  if (body) {
    req.contentType = 'application/json';
    req.payload = JSON.stringify(body);
  }
  return req;
}

function ghRequest_(method, path, body) {
  var req = ghFetchRequest_(method, path, body);
  var url = req.url;
  delete req.url;
  var res = UrlFetchApp.fetch(url, req);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub ' + code + ' (' + method + ' ' + path + '): ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

// Hiện hộp thoại khi chạy từ menu; khi chạy tự động (trigger) thì ghi log
function notify_(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
}
