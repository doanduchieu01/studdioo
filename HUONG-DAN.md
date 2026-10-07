# Stuđiô v1.0.0

Đây là **phiên bản chính thức đầu tiên**, giữ bộ tính năng đã duyệt từ v0.14.0. Tên hiển thị là Stuđiô; cấu trúc dữ liệu không đổi. Chưa phát hành lên Chrome Web Store. Xem LAUNCH-READINESS.md về các bước còn cần trước khi công bố.

1. Sao lưu dữ liệu, đóng bảng tiện ích.
2. Giải nén và thay tệp trong thư mục tiện ích cũ. Mở `chrome://extensions`, bấm **Tải lại**. Không gỡ tiện ích.
3. Mở **Settings → Language / Ngôn ngữ → Tiếng Việt**.

## Hướng dẫn khi cần

- Sau bước riêng tư, chỉ hiện một lời mời nhỏ. Chọn **Giải thích màn hình** để mở lớp hướng dẫn theo khu vực đang dùng. Không tự mở lớp phủ khi chuyển màn hình.
- Có chín hướng dẫn, tổng cộng mười chín phần giải thích, mỗi khu vực 2–3 bước. **Tiếp**, **Trước**, **Bỏ qua bước** và **Đóng hướng dẫn** không yêu cầu thêm việc, chạy đồng hồ, gọi AI hay cấp quyền.
- Lớp hướng dẫn làm nổi điều khiển liên quan và giải thích chức năng. Tab/Shift+Tab di chuyển trong hướng dẫn; Escape đóng rồi trả tiêu điểm về nút mở. Điều khiển phía dưới không được kích hoạt. Nếu chưa có điều khiển, có thể tiếp tục mà không tạo dữ liệu.
- **Để sau** tạm ẩn lời mời của khu vực đó. Nút `?` → **Trợ giúp & hướng dẫn** cho phép xem lại hoặc tắt lời mời. Luôn có thể mở thủ công; lời mời tự động tạm ẩn trong phiên tập trung và sau phiên.
- Bản nháp biểu mẫu phải được giữ khi mở, chuyển bước hoặc đóng hướng dẫn. Tiến độ chỉ lưu trên máy, không gửi AI hay vào sao lưu; giữ tiến độ cũ khi nâng cấp. Thao tác công việc thật không tự hoàn tất bước hướng dẫn. Xóa dữ liệu ứng dụng đặt lại tiến độ.

## Tính năng trên máy và AI là hai lựa chọn riêng

1. Cuối màn hình riêng tư có **Bật các tính năng bổ sung trên máy**. Công tắc mở cảnh báo trước: đọc mục đích, dữ liệu lưu trong 7 ngày, quyền cần dùng và chọn các trang muốn cho phép. Chỉ khi xác nhận mới hiện hộp xin quyền Chrome. Hủy hoặc từ chối không bật tính năng. Trạng thái bật một phần được hiển thị rõ.
2. Nhóm này gồm ghi nhận phiên, tiêu đề/tài nguyên, tín hiệu media theo trang, ước tính nghe nền và nhắc việc. Không bật AI, chia sẻ hướng dẫn/bộ nhớ, lưu khóa hay nội dung báo cáo lỗi. Tắt giữ lịch sử và quyền Chrome đã cấp; có nút **Thu hồi quyền** riêng cho từng trang.
3. Danh sách có sẵn YouTube, YouTube Music, Spotify, SoundCloud, Apple Music, Apple Podcasts, Pocket Casts, Vimeo, Zing MP3 và NhacCuaTui. Mỗi trang ban đầu chưa được cấp quyền. Trang thêm trong bản cập nhật không tự được cho phép. Khả năng đọc trạng thái tùy trình phát; không khẳng định sự chú ý.
4. Kết nối Gemini mới dùng **3.5 Flash-Lite**, ở chế độ **Chỉ khi yêu cầu**. Lựa chọn mô hình đã lưu vẫn giữ; đổi tại **Dùng và kiểm tra mô hình**. Không tự đổi mô hình khi lỗi.
5. Trong **Cài đặt → AI theo lựa chọn riêng**, chế độ tự động cần xác nhận cảnh báo; từng tính năng phân loại, gán nhãn hoạt động và học ghi nhớ vẫn bật riêng. Các lựa chọn tự động đã có được chuyển tiếp một lần. Ngắt kết nối hoặc khôi phục sao lưu sẽ tắt chế độ tự động.
6. Ba tính năng dùng chung giới hạn mặc định **3 lượt tự động/ngày**, chỉnh từ 0–100. Lỗi vẫn tính; đặt 0 để dừng. Yêu cầu thủ công và kiểm tra kết nối tính riêng; giới hạn từng tính năng vẫn áp dụng. Đây là giới hạn trong ứng dụng, không phải hạn mức Google còn lại. Giới hạn/số lượt trong ngày được giữ khi khôi phục hoặc xóa dữ liệu ứng dụng.

Giao diện mới ưu tiên một việc tiếp theo; **Chọn việc khác** đổi lựa chọn mà không chạy đồng hồ hay di chuyển lịch. Mục **Giới thiệu & ghi nhận** nêu cảm hứng từ MD Studio, OffScreen, MD Clock và MD Vinyl; hình ảnh và mã nguồn của Stuđiô được tạo riêng. Dự án độc lập.

## Bắt đầu và quyền riêng tư

- Cài mới: chọn **Bắt đầu với thiết lập đơn giản**, xem màn hình quyền riêng tư rồi **Tiếp tục với các lựa chọn này**. Có thể để tất cả tính năng tùy chọn tắt; công việc và đồng hồ không cần AI hay quyền theo dõi.
- Mỗi công tắc nêu mục đích, dữ liệu và quyền Chrome tương ứng. Theo dõi phiên, tiêu đề/tài nguyên, phát nội dung theo từng trang, nghe nền, thông báo, nhắc rà soát, Gemini, phân loại, chia sẻ hướng dẫn/bộ nhớ, học nền và báo cáo lỗi là các lựa chọn riêng. Không tự bật tính năng phụ thuộc.
- Từ chối quyền hoặc kiểm tra khóa Gemini thất bại sẽ giữ tính năng đó ở trạng thái tắt. Tùy chọn phát nội dung chỉ bật sau khi cấp quyền cho một trang cụ thể. Không yêu cầu quyền cho mọi trang. Tắt không đồng nghĩa xóa dữ liệu hay thu hồi quyền đã cấp trong Chrome.
- Mở lại tại **Cài đặt → Lựa chọn quyền riêng tư**. Bản nâng cấp giữ lựa chọn cũ, không bắt buộc làm lại hướng dẫn. Cài mới mặc định tắt cả chia sẻ hướng dẫn, chia sẻ bộ nhớ và nhắc rà soát hằng ngày.

## Luồng hằng ngày đơn giản hơn

1. Trong **Hôm nay**, nhập một tên việc và bấm **Thêm việc**. Chi tiết có thể bổ sung sau; ước tính ban đầu dùng độ dài phiên mặc định.
2. Xem hoặc chỉnh số phút rồi bấm **Bắt đầu tập trung**. Không cần qua màn hình thiết lập. **Tùy chọn đồng hồ** vẫn có cấu hình chi tiết và Pomodoro.
3. Khi đồng hồ kết thúc, công việc vẫn mở. Chỉ hoàn thành khi chọn đánh dấu xong.
4. **Ngày có thay đổi?** đưa đến đề xuất xếp lại, có bước xác nhận thời gian còn lại, xem đề xuất và áp dụng. Không tự di chuyển lịch.
5. **Hoạt động** mở bằng tổng quan nhóm. Chọn **Tất cả phiên** để xem dữ liệu gốc hoặc **Liên kết mâu thuẫn** để sửa khi cần. Thời gian ước tính và phiên chưa gắn nhãn không tạo nghĩa vụ rà soát. Nhắc rà soát lúc 18:00 cần bật riêng và chỉ báo liên kết mâu thuẫn.

Quỹ thời gian, các kiểu đồng hồ và lịch hôm nay nằm trong **Công cụ lập kế hoạch và thời gian**. Kết nối Gemini và chọn mô hình nằm trong **Cài đặt**. Bộ đếm trang web cũ vẫn có ở Cài đặt để tương thích dữ liệu cũ.

## Hoạt động — bắt đầu không cần AI

1. Mở **Hoạt động → Cài đặt ghi nhận → Bật ghi nhận phiên**. Cấp quyền tab và trạng thái không hoạt động. Bộ đếm website cũ tạm dừng; số liệu cũ vẫn được giữ.
2. Khi đọc mà không thao tác, mặc định giữ tối đa 30 phút dưới dạng ước tính; sau 10 phút đánh dấu độ không chắc chắn, không bắt buộc rà soát. Có thể chỉnh tối đa 5–180 phút hoặc dùng **Chế độ đọc** để gia hạn từ hiện tại. Khóa máy và khoảng thiếu tín hiệu hơn 90 giây không được điền bù.
3. Tùy chọn **Lưu tiêu đề và mã tài nguyên** cho phép liên kết từng trang với việc, dự án và thẻ. Trong **Dự án, thẻ và liên kết tài nguyên**, nhập URL và nhãn. Mặc định chỉ áp dụng tài nguyên cụ thể; áp dụng cả tên miền cần tích riêng.
4. Muốn nhận biết video/âm thanh, mở **Tín hiệu phát theo website**, nhập một URL, cấp quyền rồi tải lại trang. Trình phát nhúng hoặc PDF có thể không cung cấp tín hiệu. Nghe nền có tùy chọn riêng. Nội dung đang phát không chứng minh mức tập trung.
5. Chọn phiên → **Rà soát** để gán nhãn, xác nhận thời lượng, cắt, tách hoặc loại. Có thể gán nhãn nhiều phiên cùng lúc và gộp các phiên chưa cắt. **Hoàn tác** bảo vệ trước thay đổi mới; liên kết đã ghi nhớ vẫn được giữ và có thể xóa riêng.
6. Sau ít nhất 3 phiên đọc đã xác nhận trên 2 ngày, khoảng đọc có thể điều chỉnh theo trung vị, trong giới hạn tối đa đã đặt. Tắt tùy chọn thích nghi nếu muốn mức cố định.
7. Gợi ý AI có công tắc riêng, cần Gemini và lưu tiêu đề/tài nguyên. Tối đa 3 yêu cầu/ngày, kể cả lỗi; gửi tiêu đề, tên miền, số phút và các nhãn/việc ứng viên. Không gửi nội dung trang hay URL đầy đủ. AI chỉ đề xuất; **Lưu nhãn** mới áp dụng. Quy tắc đã ghi nhớ được áp dụng tự động trên máy.
8. **Khoảng thiếu và sao lưu → Xuất hoạt động** tạo bản sao riêng. Sao lưu công việc thông thường không có dữ liệu hoạt động. Nhập hoạt động luôn ở trạng thái tạm dừng. Tắt lưu chi tiết không xóa dữ liệu cũ; dùng **Xóa hoạt động** khi cần xóa.

## Nhắc việc

Mở **Cài đặt → Nhắc việc → Bật thông báo trên máy**, cấp quyền rồi lưu. Có nhắc phiên trong lịch, hạn sắp đến, kết thúc Pomodoro và rà soát hoạt động lúc 18:00. Giờ yên lặng mặc định 22:00–08:00; hai mốc bằng nhau là tắt. Nhắc việc chờ khi đang tập trung; có **Mở** và **Nhắc sau 10 phút**. Trình duyệt phải đang chạy; ngủ máy có thể làm thông báo muộn. Nội dung thông báo có thể hiện tên công việc trên màn hình.

## Xếp lại việc bị trễ

Có thể mở **Hôm nay → Ngày có thay đổi?** hoặc **Kế hoạch → Lịch → Xếp lại việc bị trễ**:

1. Chọn việc có phiên đã qua và nhập số phút thực sự còn lại.
2. Bấm **Đề xuất xếp lại**; xem giờ mới và các việc không đủ chỗ. Giữ các phiên tương lai, xét hạn chót, giờ làm việc, quỹ thời gian và khoảng nghỉ.
3. Bấm **Áp dụng xếp lại** khi phù hợp. Phiên cũ chuyển thành bỏ qua; việc chưa bị đánh dấu xong.
4. **Hoàn tác lần xếp lại gần nhất** khôi phục khi lịch chưa có thay đổi liên quan. Nếu đề xuất đã cũ hoặc giờ bắt đầu đã qua, tạo lại đề xuất.

Không thao tác trình duyệt không tự kích hoạt xếp lại. Telegram, đồng bộ đám mây và triển khai website/backend chưa có trong gói này. Các mô-đun lõi và hợp đồng tích hợp đã được tách trong INTEGRATION.md để dùng cho giai đoạn tiếp theo.

## Kanban — tùy chọn

Eisenhower và quỹ thời gian vẫn là mặc định. Trong **Kế hoạch**, chọn **Xem thử**, **Bật Kanban** hoặc **Để sau**. Xem thử không đổi dữ liệu. Có thể bật/tắt lại trong **Cài đặt → Kanban**; tắt vẫn giữ lịch sử.

- Việc đã chọn và phiên sắp tới hôm nay có thể tự vào **Sẵn sàng**. Bắt đầu bộ đếm của việc có thể chuyển sang **Đang làm**. Mỗi lần tự chuyển có lý do và **Hoàn tác** khi chưa có thay đổi mới.
- **Bắt đầu việc** chỉ đổi trạng thái, không chạy bộ đếm. Kết thúc bộ đếm không tự đánh dấu xong.
- Giới hạn mặc định: **2 việc đang làm**, gồm cả việc đang vướng. Thêm thủ công vượt giới hạn cần xác nhận; bộ đếm chỉ cảnh báo. Ghi vướng mắc thay vì đẩy việc đã bắt đầu về bước trước.
- Chuyển thủ công hoặc hoàn tác sẽ tạm dừng tự động cho việc đó. Chọn **Cho phép tự động** để dùng lại. Hoàn tác không dừng bộ đếm hay đổi lịch.
- Gợi ý việc tiếp theo kèm lý do; nhắc việc quá lâu sau 3 ngày và rà soát sau 7 ngày. Chỉ hiện trong bảng, không gửi thông báo. Đổi giới hạn và bật/tắt từng quy tắc trong Cài đặt.
- Lịch sử giữ 100 lần tự chuyển. Số liệu thời gian gồm cả chờ/nghỉ, không phải điểm năng suất. Tính trên máy, không gọi AI; sao lưu có trạng thái bảng và nội dung vướng mắc.

## Công cụ hiện có

- **Kế hoạch → Eisenhower → Chưa phân loại**: bật **AI tự phân loại**. Quy tắc xử lý thông tin rõ ràng; Gemini xử lý phần chưa rõ. Việc thiếu bằng chứng vẫn chờ phân loại. Lựa chọn thủ công được giữ.
- **Cài đặt → Hỗ trợ lập kế hoạch**: bật khi cần. Tính năng chỉ nằm trong Cài đặt. Sau bảy ngày, có thể được nhắc một lần nếu bảy ngày trọn vẹn trước đó đạt trung bình ít nhất 3 yêu cầu AI/ngày.
- **Cài đặt → Quỹ thời gian tự động**: kết hợp quỹ đã nhập, lịch sử tập trung cộng giờ nghỉ ước tính và mức mặc định. Giới hạn theo giờ làm việc. Việc và phiên hôm nay dùng để kiểm tra quá tải, không làm tăng thời gian có sẵn.
- **Cách tính → Cơ sở ước tính**: xem từng nguồn và số ngày có dữ liệu. Lấy tối đa 7 ngày mỗi nguồn trong 28 ngày trước; quỹ đã nhập có trọng số gấp đôi lịch sử tập trung. Dưới 3 ngày, mức mặc định bù phần thiếu. Không tính ngày thiếu dữ liệu là 0.
- Mức nhập riêng hôm nay luôn được giữ, kể cả 0. Chọn **Dùng ước tính** để bỏ ghi đè, vẫn giữ việc đã chọn. Tính trên máy, không gọi AI hay đọc lịch bên ngoài.
- **Hôm nay → Pomodoro**: chọn việc, thời lượng và số lượt. Tự bắt đầu hoặc bỏ qua giờ nghỉ.

Nội dung việc, ghi chú và chỉ dẫn cũ giữ nguyên. Giữ lựa chọn bật/tắt đã lưu; cài mới mặc định tắt. Phân loại qua Gemini dùng khóa và hạn mức hiện có.
