# Hướng dẫn dùng bộ khởi động LeadPilot

## LeadPilot là gì?

Một nền tảng **lọc, chấm điểm và phân phối khách hàng tiềm năng (lead) bằng AI** cho doanh nghiệp. Lead đổ về từ form, webhook, file CSV → hệ thống tự gộp trùng, tra cứu thông tin công ty, AI chấm điểm (nóng / ấm / lạnh / rác), rồi tự giao cho đúng nhân viên sale, gửi email, báo Slack/Telegram, đẩy sang HubSpot hoặc n8n.

Vì sao chọn bài toán này: đây đúng là nhóm việc khách trên Upwork đang thuê nhiều nhất (lọc lead rác, chấm điểm bằng AI, kết nối CRM, thay bảng tính). Và nó **không hề basic**: có multi-tenant, phân quyền, hàng đợi có retry, chống trùng request (idempotency), ký HMAC, mã hóa secret, theo dõi chi phí AI, eval đo độ chính xác. Đó là những thứ khách doanh nghiệp nhìn vào để quyết định thuê ai.

## Trong bộ này có gì

| File | Dùng để |
|---|---|
| `SPEC.md` | Đặc tả sản phẩm: tính năng, luồng xử lý, database, 7 milestone |
| `CLAUDE.md` | Luật dự án, Claude Code tự đọc mỗi phiên |
| `.claude/agents/code-reviewer.md` | Subagent soát code (chỉ đọc, không sửa) |
| `.claude/agents/tester.md` | Subagent viết và chạy test |
| `START_PROMPT.md` | Các prompt để dán vào Claude Code |

Các file cho Claude Code viết bằng tiếng Anh: Claude làm việc tốt hơn, và repo sau này khách quốc tế đọc được luôn.

## Bước 1: Chuẩn bị máy

- Node.js bản LTS, pnpm, Docker Desktop, Git, tài khoản GitHub
- Cài Claude Code và đăng nhập bằng tài khoản Pro: xem https://code.claude.com/docs/en/setup.md

## Bước 2: Tạo dự án

1. Tạo thư mục `leadpilot`, giải nén toàn bộ bộ này vào (giữ nguyên thư mục `.claude/agents/`)
2. `git init` và tạo repo trên GitHub
3. Mở Claude Code trong thư mục đó

## Bước 3: Chạy từng milestone

1. Dán **Prompt 1** trong `START_PROMPT.md`
2. **Đọc kỹ kế hoạch Claude đưa ra.** Chỗ nào không hiểu thì hỏi lại ngay. Đây là lúc bạn học nhiều nhất.
3. Duyệt → Claude code → `tester` chạy test → `code-reviewer` soát → sửa lỗi → commit
4. Xong M0 thì dùng prompt "milestone tiếp theo" cho M1, M2...
5. Cuối mỗi milestone dùng prompt "learning check": đi phỏng vấn hay nói chuyện với khách, bạn phải tự giải thích được dự án của mình

## Mẹo tiết kiệm hạn mức gói Pro

- Mỗi milestone (hoặc mỗi tính năng lớn) mở một phiên mới hoặc dùng `/clear`; nhờ `CLAUDE.md` mà Claude không mất ngữ cảnh dự án
- Luôn bắt Claude **lập kế hoạch trước**: sửa kế hoạch rẻ hơn nhiều so với sửa code
- Đừng gọi subagent cho việc vặt; chỉ gọi khi xong một tính năng
- Chạm giới hạn thì nghỉ, đọc lại code Claude viết. Thời gian đó không phí đâu.

## Tiến độ dự kiến (full time)

| Tuần | Việc |
|---|---|
| 1 | M0 + M1 + M2 |
| 2 | M3 + M4 |
| 3 | M5 + M6, deploy, quay video, viết README |
| 3–4 | Lên hồ sơ Upwork/Fiverr, bắt đầu gửi proposal |

Bạn không cần đợi xong hết mới lên hồ sơ. Xong M3 là đã có đủ thứ để khoe trong proposal về AI lead scoring rồi.

## Khi đã xong

Quay lại đây nói với mình. Mình sẽ cùng bạn viết README tiếng Anh, kịch bản video demo, hồ sơ Upwork, gig Fiverr và mẫu proposal dựa trên chính dự án này.
