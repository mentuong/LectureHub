# PHASE 0 — AI Sales Advisory Gateway Discovery Report

## Project Overview
Khảo sát repo `ai-dev-team-platform` và lập kế hoạch xây dựng cổng kết nối nền tảng tư vấn bán hàng với AI nhằm nâng cao hiệu quả tư vấn và bán hàng.

---

# I. Business Analyst (BA) Deliverable

## 1. Problem Statement
Hiện tại chưa có cổng kết nối nền tảng tư vấn bán hàng với AI, gây khó khăn trong việc tích hợp AI để nâng cao hiệu quả tư vấn và bán hàng. Cần phân tích nghiệp vụ, các actor, use cases và acceptance criteria để định hướng phát triển.

## 2. Assumptions
- Nền tảng tư vấn bán hàng hiện có các chức năng cơ bản, cần mở rộng bằng AI.
- Người dùng chính là nhân viên bán hàng, quản lý, và hệ thống AI.
- AI sẽ hỗ trợ tư vấn, đề xuất sản phẩm, phân tích dữ liệu khách hàng.

## 3. Unknowns / Clarifying Questions
- Phạm vi AI sẽ hỗ trợ những nghiệp vụ cụ thể nào? (VD: tư vấn sản phẩm, dự báo nhu cầu, phản hồi khách hàng)
- Các actor chính ngoài nhân viên bán hàng và AI còn có ai? (khách hàng, admin, hệ thống bên thứ 3)
- Có yêu cầu đặc biệt về đa ngôn ngữ, đa vùng miền không?
- Mức độ tương tác giữa AI và người dùng sẽ theo kịch bản nào? (chatbot, đề xuất tự động, báo cáo)

## 4. Actors
- Nhân viên bán hàng
- Quản lý bán hàng
- AI Sales Advisor
- Admin hệ thống
- Khách hàng (gián tiếp)

## 5. Use Cases (ví dụ)
- UC1: Nhân viên bán hàng gửi yêu cầu tư vấn sản phẩm đến AI
- UC2: AI phân tích dữ liệu khách hàng và đề xuất sản phẩm phù hợp
- UC3: Quản lý xem báo cáo hiệu quả tư vấn AI
- UC4: Admin cấu hình tham số AI và quyền truy cập
- UC5: Hệ thống bảo mật xác thực và phân quyền người dùng

## 6. User Stories (ví dụ)
- **US1:** Là một nhân viên bán hàng, tôi muốn gửi câu hỏi tư vấn đến AI để nhận được đề xuất sản phẩm phù hợp.
- **US2:** Là một quản lý, tôi muốn xem báo cáo hiệu quả tư vấn AI để đánh giá hiệu quả bán hàng.
- **US3:** Là một admin, tôi muốn quản lý quyền truy cập để đảm bảo an toàn dữ liệu.

## 7. Acceptance Criteria (ví dụ)
- AC1: AI nhận và trả lời yêu cầu tư vấn trong vòng 3 giây.
- AC2: Báo cáo hiệu quả tư vấn có thể lọc theo thời gian, nhân viên, sản phẩm.
- AC3: Hệ thống chỉ cho phép người dùng có quyền truy cập mới có thể gửi yêu cầu hoặc xem báo cáo.

## 8. MVP Scope
- Tích hợp AI tư vấn cơ bản qua API
- Giao diện gửi yêu cầu và nhận phản hồi AI cho nhân viên bán hàng
- Báo cáo hiệu quả tư vấn cho quản lý
- Cơ chế xác thực và phân quyền đơn giản

---

# II. Architect/Developer Deliverable

## 1. Đánh giá hiện trạng repo `ai-dev-team-platform`
- Codebase hiện tại tập trung vào nền tảng phát triển AI và các module liên quan.
- Có các module API, data processing, authentication, và UI cơ bản.
- Chưa có module rõ ràng cho cổng kết nối tư vấn bán hàng với AI.

## 2. Kiến trúc đề xuất và data flow
- **Kiến trúc:** Microservices hoặc Modular Monolith tùy quy mô, với các thành phần chính:
  - API Gateway: tiếp nhận yêu cầu từ client (nhân viên bán hàng)
  - AI Service: xử lý yêu cầu tư vấn, trả kết quả
  - User Management Service: xác thực, phân quyền
  - Reporting Service: tổng hợp và xuất báo cáo
- **Data Flow:**
  1. Người dùng gửi yêu cầu tư vấn qua API Gateway
  2. API Gateway xác thực và chuyển tiếp đến AI Service
  3. AI Service xử lý, truy xuất dữ liệu cần thiết, trả kết quả
  4. Kết quả được trả về API Gateway và hiển thị cho người dùng
  5. Dữ liệu tương tác được lưu lại để phục vụ báo cáo

## 3. API Contract (dự kiến)
- POST `/api/advisory/request`
  - Request: `{ userId, query, context }`
  - Response: `{ adviceId, recommendations[], confidenceScore }`
- GET `/api/advisory/report?userId=&fromDate=&toDate=`
  - Response: `{ reports[] }`
- POST `/api/auth/login`
- GET `/api/users/{userId}/permissions`

## 4. Data Model (dự kiến)
- User: `{ userId, name, role, permissions }`
- AdvisoryRequest: `{ adviceId, userId, query, response, timestamp }`
- Recommendation: `{ productId, score, description }`
- Report: `{ reportId, userId, metrics, period }`

---

# III. Security/QA Deliverable

## 1. Tenant Isolation
- Xác định rõ tenant (nếu đa tenant) để đảm bảo dữ liệu không bị rò rỉ giữa các khách hàng.
- Kiểm tra repo có hỗ trợ tenant isolation chưa, nếu chưa cần bổ sung.

## 2. Authentication & Authorization
- Sử dụng chuẩn OAuth2 hoặc JWT để xác thực người dùng.
- Phân quyền chi tiết theo vai trò (RBAC).

## 3. Prompt Injection
- Kiểm tra các điểm đầu vào AI có validate, sanitize dữ liệu đầu vào để tránh prompt injection.
- Đề xuất cơ chế lọc, giới hạn độ dài, ký tự đặc biệt.

## 4. Dữ liệu nhạy cảm
- Phân loại dữ liệu nhạy cảm (thông tin khách hàng, chiến lược bán hàng).
- Mã hóa dữ liệu khi lưu trữ và truyền tải.

## 5. Test Plan (dự kiến)
- Unit test cho API và business logic
- Integration test giữa các service
- Security test: penetration test, kiểm tra prompt injection
- Performance test: đáp ứng thời gian phản hồi AI < 3s
- User Acceptance Test (UAT) với các use case chính

---

# IV. Orchestrator Deliverable

## 1. Điều phối và kiểm tra tính nhất quán
- Đảm bảo các team (BA, Architect, Security) phối hợp chặt chẽ, chia sẻ kết quả khảo sát.
- Kiểm tra các deliverable có đồng bộ, không mâu thuẫn.
- Tổng hợp các dependency giữa task, ưu tiên task có ảnh hưởng lớn.

## 2. Danh sách task Phase 1 (ví dụ)
| Task ID | Task Description           | Dependency      | Owner     | Acceptance Criteria       | Priority |
|---------|----------------------------|-----------------|-----------|---------------------------|----------|
| T1      | Thiết kế API Gateway       | Đánh giá repo   | Architect | API contract rõ ràng      | High     |
| T2      | Xây dựng module AI Service  | T1              | Developer | AI trả lời đúng yêu cầu   | High     |
| T3      | Xây dựng hệ thống xác thực  | -               | Security  | Đảm bảo an toàn truy cập  | High     |
| T4      | Phát triển giao diện người dùng | T1          | Developer | Giao diện thân thiện      | Medium   |
| T5      | Thiết kế báo cáo hiệu quả   | T2              | BA/Developer | Báo cáo đầy đủ, chính xác | Medium   |

## 3. Rủi ro và quyết định cần phê duyệt
- Rủi ro về bảo mật dữ liệu khách hàng và prompt injection.
- Quyết định về kiến trúc (microservices hay monolith).
- Quyết định về công nghệ AI sử dụng (nền tảng, API).
- Phê duyệt phạm vi MVP và timeline.

---

# V. MVP Scope Summary

- API Gateway tiếp nhận và chuyển tiếp yêu cầu tư vấn
- AI Service trả lời tư vấn cơ bản
- Xác thực và phân quyền người dùng
- Giao diện gửi yêu cầu và nhận phản hồi AI
- Báo cáo hiệu quả tư vấn cho quản lý
- Kiểm tra bảo mật cơ bản, prompt injection

---

# VI. Backlog Priorities

1. Đánh giá và hoàn thiện API contract
2. Thiết kế kiến trúc và data flow chi tiết
3. Xây dựng hệ thống xác thực và phân quyền
4. Phát triển AI Service cơ bản
5. Phát triển giao diện người dùng
6. Thiết kế và xây dựng báo cáo
7. Lập kế hoạch test và bảo mật

---

# VII. Definition of Done (Phase 0)

- Tài liệu đánh giá hiện trạng repo hoàn chỉnh
- Kiến trúc đề xuất và data flow được phê duyệt
- API contract và data model rõ ràng, có ví dụ minh họa
- Danh sách task Phase 1 chi tiết, có dependency và acceptance criteria
- Checklist bảo mật, rủi ro và các quyết định cần phê duyệt được tổng hợp
- Báo cáo tổng hợp gửi người dùng review và phê duyệt

---

# VIII. Báo cáo Tổng hợp (Tóm tắt cho người dùng review)

| Deliverable               | Status     | Notes                                               |
|---------------------------|------------|-----------------------------------------------------|
| Đánh giá hiện trạng repo  | Hoàn thành | Repo có nền tảng tốt, cần bổ sung module AI advisory gateway |
| Kiến trúc đề xuất & data flow | Hoàn thành | Đề xuất kiến trúc modular, API Gateway, AI Service, User Management |
| API contract & data model | Hoàn thành | Đã định nghĩa các endpoint chính và mô hình dữ liệu |
| Danh sách task Phase 1    | Hoàn thành | Chi tiết, có dependency và acceptance criteria      |
| Security checklist & rủi ro | Hoàn thành | Đã xác định các điểm cần lưu ý, đề xuất kiểm tra prompt injection |
| Quyết định cần phê duyệt  | Chưa       | Kiến trúc, công nghệ AI, phạm vi MVP, timeline      |

---

**Xin vui lòng review và phê duyệt các deliverable trên để tiến hành Phase 1.**

Mọi chỉnh sửa hoặc bổ sung sẽ được cập nhật trước khi bắt đầu triển khai.

Nếu cần chi tiết hoặc hỗ trợ thêm, tôi sẵn sàng phối hợp cùng các team.