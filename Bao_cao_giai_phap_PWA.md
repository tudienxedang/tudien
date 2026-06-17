# 🔬 Giải Pháp PWA Offline Âm Thanh — Dự Án Từ Điển Xơ Đăng

---

## 1. Nguyên Nhân Gốc Rễ (Đã xác minh từ code)

### Hiện tại âm thanh hoạt động thế nào?

```
Google Sheets cột D → Drive ID (vd: 1drFf_X4AoN_I5paNJMJugX4NsCuKsWx)
         ↓
Code index.html (dòng 4857) tạo URL:
    https://drive.google.com/file/d/{DriveID}/preview
         ↓
Nhúng vào <iframe> trên trang web
         ↓
Trình duyệt phải kết nối Google Drive để tải iframe
         ↓
❌ MẤT INTERNET → IFRAME KHÔNG TẢI → KHÔNG CÓ ÂM THANH
```

### 4 lý do cụ thể không hoạt động offline:

| # | Nguyên nhân | Vị trí trong code |
|---|---|---|
| 1 | Dùng **iframe Google Drive** — cần internet 100% | index.html dòng 4857-4873 |
| 2 | Service Worker **không cache** request đến `drive.google.com` | service-worker.js dòng 98-135 |
| 3 | Danh sách cache **chỉ có HTML + icons**, không có audio | service-worker.js dòng 10-28 |
| 4 | File audio nằm trên **domain khác** (cross-origin) → SW không can thiệp được | service-worker.js dòng 131 |

---

## 2. Vấn Đề Mapping File (Bạn Đã Chỉ Ra Đúng)

Nếu tải thủ công từ Google Drive:
- File tải về có tên: `thu_am_13_27_19_17766...webm`
- Cột D trong Sheets ghi: `1drFf_X4AoN...`
- **KHÔNG biết file nào ứng với ID nào!**

### ✅ Giải pháp: Dùng chính Drive ID làm tên file

```
Cột D (GIỮ NGUYÊN):    1drFf_X4AoN_I5paNJMJugX4NsCuKsWx

Tên file trên GitHub:   audio/1drFf_X4AoN_I5paNJMJugX4NsCuKsWx.webm
                               ↑ chính là Drive ID từ cột D

Code chỉ sửa:           ./audio/${driveId}.webm
```

**→ Không cần đổi Google Sheets. Không cần mapping. Tự động khớp!**

---

## 3. Quy Trình Thực Hiện (5 Bước)

### Bước 1: Chạy Apps Script để tải + đổi tên file tự động (Hỗ trợ >1000 file)

Google Apps Script của tài khoản cá nhân có giới hạn thời gian **chạy tối đa 6 phút**. Với hơn 1000 file, script chạy sẽ bị timeout giữa chừng. 

Do đó, đoạn code dưới đây đã được tối ưu hóa để **tự động lưu trạng thái (resumable)**:
* Quét thư mục xuất để kiểm tra xem file nào đã tải từ trước.
* Nếu đã tải rồi, script tự động bỏ qua để tiết kiệm thời gian.
* Nếu sắp chạm ngưỡng 5 phút, script tự động dừng lại và báo cho bạn biết cần bấm nút **Run** tiếp. Bạn chỉ cần chạy khoảng 3-4 lần là tải xong hết 1000+ file mà không lo lỗi hay trùng lặp.

Mở Google Sheets của bạn → **Extensions → Apps Script** → Paste code sau → Lưu:

```javascript
// ====================================================================
// SCRIPT TẢI AUDIO TỪ DRIVE, ĐỔI TÊN = DRIVE ID (HỖ TRỢ >1000 FILE)
// Chạy hàm: downloadAllAudioToFolder
// ====================================================================

function downloadAllAudioToFolder() {
  var startTime = new Date().getTime();
  var maxTimeMs = 5 * 60 * 1000; // Giới hạn 5 phút để tránh bị crash do quá 6 phút của Google
  
  var sheet = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = sheet.getSheetByName('Tu_Dien');
  
  if (!dataSheet) {
    SpreadsheetApp.getUi().alert('Không tìm thấy sheet "Tu_Dien"! Hãy kiểm tra lại tên sheet của bạn.');
    return;
  }
  
  var lastRow = dataSheet.getLastRow();
  var driveIds = dataSheet.getRange(2, 4, lastRow - 1, 1).getValues(); // Lấy tất cả cột D (từ dòng 2)
  
  // Tạo hoặc lấy folder export trên Drive
  var exportFolder;
  var folders = DriveApp.getRootFolder().getFoldersByName('GitHub_Audio_Export');
  
  if (folders.hasNext()) {
    exportFolder = folders.next();
  } else {
    exportFolder = DriveApp.getRootFolder().createFolder('GitHub_Audio_Export');
  }
  
  // Quét danh sách file đã tải trước đó để tránh tải trùng (tiết kiệm thời gian khi chạy lại)
  var existingFiles = {};
  var files = exportFolder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    existingFiles[file.getName()] = true;
  }
  
  var successCount = 0;
  var skipCount = 0;
  var alreadyExistCount = 0;
  var errorCount = 0;
  var errors = [];
  var isTimeout = false;
  
  for (var i = 0; i < driveIds.length; i++) {
    // Nếu quá 5 phút, tạm dừng để lưu trạng thái
    if (new Date().getTime() - startTime > maxTimeMs) {
      isTimeout = true;
      break;
    }
    
    var driveId = (driveIds[i][0] || '').toString().trim();
    
    // Bỏ qua nếu dòng trống hoặc không chứa Drive ID hợp lệ
    if (!driveId || driveId === 'null' || driveId === 'undefined' || driveId === '') {
      skipCount++;
      continue;
    }
    
    // Kiểm tra xem ID này đã được tải xuống chưa (quét tất cả đuôi file phổ biến)
    var possibleNames = [driveId + '.webm', driveId + '.mp3', driveId + '.wav', driveId + '.ogg'];
    var exists = false;
    for (var j = 0; j < possibleNames.length; j++) {
      if (existingFiles[possibleNames[j]]) {
        exists = true;
        break;
      }
    }
    
    if (exists) {
      alreadyExistCount++;
      continue; // Đã tải rồi → bỏ qua dòng này
    }
    
    try {
      // Tải blob từ Drive
      var originalFile = DriveApp.getFileById(driveId);
      var blob = originalFile.getBlob();
      
      // Xác định định dạng file
      var originalName = originalFile.getName();
      var extension = '.webm'; // Mặc định là webm
      
      if (originalName.indexOf('.mp3') > -1) {
        extension = '.mp3';
      } else if (originalName.indexOf('.wav') > -1) {
        extension = '.wav';
      } else if (originalName.indexOf('.ogg') > -1) {
        extension = '.ogg';
      }
      
      var newFileName = driveId + extension;
      blob.setName(newFileName);
      
      // Lưu file vào thư mục export
      exportFolder.createFile(blob);
      existingFiles[newFileName] = true;
      successCount++;
      
      if (successCount % 20 === 0) {
        Logger.log('Đã xử lý tải: ' + successCount + ' file');
      }
    } catch (e) {
      errorCount++;
      errors.push('Dòng ' + (i + 2) + ', ID: ' + driveId + ' → Lỗi: ' + e.message);
    }
  }
  
  var message = '';
  if (isTimeout) {
    message += '⚠️ ĐÃ TẠM DỪNG VÌ HẾT THỜI GIAN (5 PHÚT)\n';
    message += 'Do Google giới hạn thời gian chạy 6 phút/lần, Script đã dừng để không bị lỗi.\n';
    message += '👉 BẠN CHỈ CẦN NHẤN NÚT ▶ RUN LẠI để tiếp tục tải các file chưa hoàn thành!\n\n';
  } else {
    message += '✅ ĐÃ HOÀN THÀNH TOÀN BỘ!\n\n';
  }
  
  message += '📊 THỐNG KÊ:\n' +
             '✔ Đã tải mới trong lần chạy này: ' + successCount + ' file\n' +
             '⏩ Đã tồn tại từ trước (bỏ qua): ' + alreadyExistCount + ' file\n' +
             '⏩ Dòng trống/không hợp lệ: ' + skipCount + ' dòng\n' +
             '❌ File gặp lỗi: ' + errorCount + ' file\n\n' +
             '📂 Thư mục: Google Drive → "GitHub_Audio_Export"';
             
  if (errors.length > 0) {
    message += '\n\n❌ Chi tiết lỗi 5 file đầu tiên:\n' + errors.slice(0, 5).join('\n');
  }
  
  SpreadsheetApp.getUi().alert(message);
}
```

**Cách chạy:**
1. Mở Google Sheets của bạn.
2. Menu **Extensions → Apps Script**.
3. Xóa toàn bộ code cũ (nếu có), paste code mới này vào.
4. Nhấn nút **▶ Run** (đảm bảo chọn hàm chạy là `downloadAllAudioToFolder`).
5. Cấp quyền truy cập Drive khi được hỏi.
6. Đợi script chạy. Nếu nó dừng lại và hiện thông báo **"ĐÃ TẠM DỪNG VÌ HẾT THỜI GIAN"**, bạn chỉ cần **Nhấn lại nút ▶ Run** một lần nữa. Lặp lại cho đến khi nhận được thông báo **"ĐÃ HOÀN THÀNH TOÀN BỘ!"**.

---

### Bước 2: Tải folder từ Drive về máy

1. Mở Google Drive → tìm folder **"GitHub_Audio_Export"**.
2. Chọn tất cả file bên trong.
3. Chuột phải → **Tải xuống** (Google Drive sẽ tự động nén thành các file `.zip`).
4. Giải nén toàn bộ ra máy tính của bạn.

---

### Bước 3: Upload lên GitHub

**Cách A — Upload trực tiếp qua giao diện Web GitHub:**
1. Truy cập repo `tudienxedang/tudien` → thư mục `audio/`.
2. Chọn **Add file → Upload files**.
3. Kéo thả các file đã giải nén vào.
4. Commit changes.
*(Lưu ý: Web GitHub giới hạn upload tối đa 100 file mỗi lần kéo thả)*

**Cách B — Upload bằng Git CLI (Khuyên dùng khi có >1000 file):**
```bash
cd path/to/tudien
# Copy toàn bộ file đã giải nén từ thư mục GitHub_Audio_Export vào thư mục audio/ của dự án
git add audio/
git commit -m "Thêm toàn bộ file âm thanh offline"
git push origin main
```

---

### Bước 4: Sửa code index.html

Chỉ cần sửa **1 đoạn** từ dòng 4854-4877 trong file `index.html`:

**Code cũ (xóa):**
```javascript
// Audio player với Google Drive iframe - ĐÃ ẨN ICON ÂM THANH
let audioPlayer = '';
if (driveId && driveId.trim() !== '' && driveId !== 'null' && driveId !== 'undefined') {
    const audioUrl = `https://drive.google.com/file/d/${driveId}/preview`;
    
    audioPlayer = `
        <div class="audio-player-container">
            <div class="audio-player-title">
                <i class="fas fa-volume-up" style="display: none !important;"></i> Phát âm:
            </div>
            <div class="drive-player-wrapper">
                <iframe 
                    class="drive-audio-player"
                    src="${audioUrl}" 
                    frameborder="0" 
                    allow="autoplay; encrypted-media" 
                    allowfullscreen
                    title="Phát âm tiếng Xơ Đăng"
                    loading="lazy">
                </iframe>
            </div>
            <div class="audio-info">Phát âm chuẩn người bản địa Xơ đăng</div>
        </div>
    `;
}
```

**Code mới (thay thế):**
```javascript
// Audio player - file local (hỗ trợ offline PWA)
let audioPlayer = '';
if (driveId && driveId.trim() !== '' && driveId !== 'null' && driveId !== 'undefined') {
    const audioUrl = `./audio/${driveId}.webm`;
    
    audioPlayer = `
        <div class="audio-player-container">
            <div class="audio-player-title">Phát âm:</div>
            <audio controls preload="none" style="width:100%; border-radius:8px;">
                <source src="${audioUrl}" type="audio/webm">
                Trình duyệt không hỗ trợ phát âm thanh.
            </audio>
            <div class="audio-info">Phát âm chuẩn người bản địa Xơ đăng</div>
        </div>
    `;
}
```

---

### Bước 5: Cập nhật phiên bản Service Worker

Mở file `service-worker.js` và cập nhật phiên bản ở dòng số 5:

```diff
- const APP_VERSION = '9.1.0';
+ const APP_VERSION = '10.0.0';
```

---

## 4. Tại Sao Giải Giải Pháp Này Hoạt Động Offline?

Khi file âm thanh nằm ở thư mục local trên GitHub Pages (`./audio/`), Service Worker của bạn (đoạn hàm `handleStaticRequest` ở dòng 296) sẽ tự động chặn request và lưu file vào **Cache Storage** trong lần đầu tiên người dùng nghe từ vựng đó khi có mạng. 

Ở các lần tiếp theo khi không có mạng, trình duyệt sẽ tự động lấy trực tiếp file âm thanh từ Cache Storage để phát ngay lập tức.
