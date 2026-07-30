# Prompt: AI Factory — Capability Reactor

Bạn là một **senior creative developer, WebGL engineer và motion art
director**. Hãy tạo một landing-page hero/section Three.js có chất lượng trình
diễn cao, bám sát phần **Opus 5 ở nửa trên của video tham chiếu được đính kèm**.

## 1. Nhiệm vụ

Tạo đúng một file:

```text
ai-factory-atom.html
```

File phải dựng một cảnh “AI Factory — Capability Reactor”: một lõi năng lượng
bằng hàng nghìn shard kim loại sáng, được bao quanh bởi ba vành quỹ đạo nghiêng.
Hình ảnh truyền tải:

> Compute is converted into capability.

Đây không chỉ là một “atom sci-fi” trang trí. Vành ngoài phải có cảm giác là
compute thô, phân tán và hỗn loạn; lõi phải đặc, sáng, có trật tự và có sức nặng,
như tài nguyên tính toán đang được cô đọng thành năng lực.

Không hỏi lại nếu không thật sự bị chặn. Hãy tự đưa ra quyết định hợp lý, dựng,
chạy thử, quan sát, sửa và chỉ bàn giao khi các tiêu chí bên dưới đạt yêu cầu.

## 2. Cách sử dụng video tham chiếu

Trước khi viết code:

1. Xem toàn bộ video.
2. Chỉ dùng **kết quả Opus 5 ở nửa trên** làm chuẩn hình ảnh.
3. Quan sát ít nhất các mốc gần 0, 8, 16, 24, 32 và 38 giây để hiểu silhouette,
   chuyển động, vật liệu, ánh sáng và cách vật thể đọc ở nhiều góc.
4. Phần khung so sánh màu vàng chanh, cùng các nhãn “Opus 5”, “1hr 30mins”,
   “$20”, “Kimi K3”, “42 mins” và “$13” thuộc video so sánh, **không phải giao
   diện website**. Tuyệt đối không đưa chúng vào sản phẩm.
5. Khi mô tả chữ và video mâu thuẫn về cảm giác thị giác, ưu tiên video cho
   silhouette, tỷ lệ, ánh sáng, nhịp chuyển động và bố cục; vẫn giữ các yêu cầu
   kỹ thuật, accessibility và hiệu năng trong prompt này.

Mục tiêu là tái tạo **cảm giác và cấu trúc thị giác** của bản Opus 5, không phải
chép logo hoặc tài sản có bản quyền từ bên thứ ba.

## 3. Đầu ra và ràng buộc kỹ thuật

- Chỉ tạo một file HTML; CSS và JavaScript nằm trong file.
- Không React, không framework, không npm, không bundler, không build step.
- Dùng Three.js ES modules qua CDN.
- Ghim một phiên bản Three.js cụ thể; không dùng URL `latest`.
- `three.module.js`, `EffectComposer`, `RenderPass` và `UnrealBloomPass` phải
  cùng phiên bản và cùng hệ CDN để tránh lệch module.
- File chạy bằng local static server, ví dụ:

  ```bash
  python -m http.server 8000
  ```

- Không tuyên bố file “offline” hoặc “không dependency”; đây là một file authored
  duy nhất nhưng có runtime dependency từ CDN.
- Không dùng ảnh, model 3D hoặc texture tải từ nguồn ngoài. Texture glow nếu cần
  phải sinh bằng canvas trong code.
- Không trả pseudocode, đoạn trích hoặc hướng dẫn chung. Hãy tạo file hoàn chỉnh,
  có thể chạy.

Tổ chức script thành các khối/hàm có trách nhiệm rõ ràng, tối thiểu gồm:

```text
CONFIG
QUALITY_PROFILES
createSeededRandom()
detectInitialQuality()
createRenderer()
createScene()
createCore()
createOrbitalRing()
createAtmosphere()
createPostProcessing()
bindInteractions()
applyQualityProfile()
animate()
dispose()
```

Tên cụ thể có thể thay đổi nhẹ, nhưng cấu trúc phải dễ đọc và mọi thông số nghệ
thuật quan trọng phải nằm trong `CONFIG` ở đầu script.

## 4. Art direction

### Tinh thần

- Cinematic sci-fi cao cấp, tối, kim loại, chính xác và có chiều sâu.
- Gần như toàn bộ khung hình là đen; lõi là điểm sáng duy nhất thực sự mạnh.
- Một tông lạnh trắng–lavender làm chủ đạo và chỉ một hơi ấm rất tiết chế.
- Chuyển động chậm, liên tục, có quán tính; không hoạt hình, không giật, không
  phô diễn kỹ xảo.
- Thành phẩm phải trông như một hệ thống compute đang vận hành, không giống
  template crypto/metaverse.

### Những thứ phải tránh

- Không rainbow/neon nhiều màu.
- Không gradient tím–xanh rực phủ toàn màn hình.
- Không glass card, pill, badge hoặc nút phát sáng không cần thiết.
- Không lạm dụng lưới, scanline, HUD và chữ kỹ thuật giả.
- Không bụi dày như không gian vũ trụ.
- Không bloom mạnh đến mức lõi thành đĩa trắng phẳng.
- Không dùng torus đặc hoặc đường tròn hoàn hảo thay cho các vành shard.
- Không đặt vật thể chính giữa desktop.
- Không để tất cả shard cùng kích thước, cùng hướng hoặc cùng màu.

## 5. Bố cục và typography

### Desktop từ 1100 px trở lên

- Section chiếm tối thiểu `100svh`, nền `#050506`.
- Bố cục chia bất đối xứng: nội dung khoảng 38–42% bên trái, cảnh 3D khoảng
  58–62% bên phải.
- Reactor lệch phải và hơi cao hơn tâm dọc; ở góc mặc định, toàn cụm chiếm
  khoảng 52–58% chiều cao viewport.
- Chừa negative space rõ ràng. Vành ngoài không chạm mép viewport.
- Text nằm trên lớp DOM, không render vào WebGL.

### Nội dung

Nav trên:

```text
● AI FACTORY
ARCHITECTURE   SYSTEMS   RESEARCH
SYSTEM ONLINE
```

Khối nội dung:

```text
03 / CAPABILITY

Compute is converted
into capability.

Raw compute, tools, memory and evaluation are organised into a system
that can perceive, decide and act.
```

Lưới chỉ số minh họa:

```text
GPU HOURS          1284
EVAL PASS RATE     93.2%
RELIABILITY        0.982
UTILISATION        87.4%
ENERGY / TASK      0.41 kWh
```

Thêm nhãn nhỏ “ILLUSTRATIVE SYSTEM METRICS” để không khiến dữ liệu giả trông
như số liệu thật.

Gợi ý tương tác ở đáy:

```text
drag to orbit · scroll to zoom
```

Typography:

- Heading/body: `"Helvetica Neue", "Inter", Arial, sans-serif`.
- Nhãn và số liệu: `ui-monospace, "SFMono-Regular", Consolas, monospace`.
- Heading lớn nhưng không chiếm toàn màn hình; độ rộng dòng được kiểm soát.
- Nhãn mono dùng uppercase, tracking rộng và opacity thấp.
- Chữ chính `#f2f2f0`; chữ phụ `#8a8a86`.
- Không sử dụng font CDN.

## 6. Capability Reactor

### 6.1 Lõi

- Dùng một `InstancedMesh`.
- High profile bắt đầu với khoảng 2.600 shard; có thể tinh chỉnh trong phạm vi
  ±15% nếu screenshot hoặc FPS cho thấy cần thiết.
- Geometry là các cuboid nhỏ, hơi dài và không đều; không dùng các sphere tròn
  như hạt bụi.
- Mỗi shard có scale, rotation, màu và độ sáng lệch nhẹ theo seeded random.
- Bán kính lõi khởi điểm khoảng `1.85` world units.
- Phân bố phải thực sự dày ở tâm. Không dùng
  `r = R * cbrt(random)` rồi mô tả là dồn tâm, vì công thức đó tạo mật độ thể
  tích gần đồng đều.
- Có thể bắt đầu bằng:

  ```js
  r = R * Math.pow(u, 0.50);
  ```

  sau đó tinh chỉnh exponent khoảng `0.46–0.58` bằng quan sát. Mục tiêu là lõi
  đặc nhưng vẫn đọc được từng shard ở lớp ngoài.
- Dùng seeded PRNG, ví dụ Mulberry32 hoặc tương đương. Cùng seed phải tạo cùng
  bố cục sau mỗi lần reload.
- Vật liệu khởi điểm:

  ```text
  MeshStandardMaterial
  metalness ≈ 0.55
  roughness ≈ 0.34
  vertexColors = true
  ```

- Màu dao động hẹp quanh ivory/lavender; tránh tím bão hòa.
- Lõi tự quay rất chậm để highlight di chuyển, nhưng không quay nhanh hơn toàn
  bộ cụm.

### 6.2 Ba vành quỹ đạo

Mỗi vành là một `InstancedMesh` độc lập gồm shard kim loại nhỏ. Dùng bảng này
làm điểm bắt đầu cho high profile:

| Ring | Shard | Radius | Thickness | Rotation X | Rotation Z | Angular speed |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 520 | 3.50 | 0.18 | 0.55 | 0.20 | +0.24 rad/s |
| 2 | 600 | 4.30 | 0.22 | -0.90 | -0.40 | -0.36 rad/s |
| 3 | 460 | 3.90 | 0.16 | 0.20 | 1.15 | +0.30 rad/s |

Yêu cầu:

- Các shard phân bố trên đai ellipse/circle trong local space, có noise nhẹ ở
  bán kính, độ cao và tangent.
- Shard phải có xu hướng đi theo tiếp tuyến của quỹ đạo nhưng vẫn có nhiễu
  rotation, để vành đọc như dòng vật chất chứ không như vòng hạt ngẫu nhiên.
- Ba mặt phẳng nghiêng phải tạo silhouette đan chéo giống bản Opus 5 ở góc mặc
  định.
- Hai vành quay cùng chiều, một vành quay ngược để tạo nhịp giao thoa.
- Thêm tối đa hai đường ellipse mảnh, opacity khoảng `0.08–0.14`; chúng chỉ là
  guide line, không được sáng hơn shard.
- Tổng high profile theo các số trên là khoảng 4.180 shard, không gọi nhầm là
  4.600.

### 6.3 Dấu hiệu “compute → capability”

Thêm một chuyển động rất tiết chế giúp ý tưởng khác với atom chung chung:

- Một tỷ lệ nhỏ shard ở vùng trong của các vành có thể dao động nhẹ hướng vào
  lõi rồi trở lại, hoặc có brightness wave chạy từ vành vào tâm.
- Hiệu ứng này phải chậm, khó nhận thấy ở cái nhìn đầu tiên và không thay đổi
  silhouette chính.
- Không morph toàn cảnh, không hút hạt liên tục như vortex và không làm giảm
  cảm giác sang trọng.

## 7. Ánh sáng, màu và atmosphere

Palette:

```text
Background       #050506
Primary text     #f2f2f0
Secondary text   #8a8a86
Core ivory       khoảng #d9d9e8
Lavender rim     #8a7bff
Warm accent      #ff8a5c, dùng rất ít
```

Lighting starting point:

- Key trắng ở trên–phải–trước, intensity khoảng `1.6`.
- Rim lavender ở dưới–trái–sau, intensity khoảng `1.3`.
- Warm fill ở dưới–sau, intensity khoảng `0.6–0.8`.
- Ambient xám xanh đủ đọc vùng tối nhưng không làm cảnh phẳng.
- Dùng physically sensible falloff/range nếu chọn point lights.
- Dùng color management và filmic tone mapping phù hợp; exposure phải nằm trong
  `CONFIG`.

Atmosphere:

- Fog cùng màu nền, đủ để các phần phía sau tan vào đen nhưng không xóa vành.
- High profile có tối đa vài trăm background points rất mờ.
- Không dùng 900 hạt nền nếu chúng gây nhiễu silhouette.
- Vignette CSS được phép nhưng phải tĩnh; không animate `filter`,
  `box-shadow` hoặc gradient liên tục.

## 8. Bloom thích ứng

Trên `high` và `balanced`, dùng:

```text
EffectComposer
RenderPass
UnrealBloomPass
```

Giá trị khởi điểm, không phải con số bất biến:

```text
strength  0.45–0.70
radius    0.25–0.45
threshold 0.50–0.70
```

Yêu cầu:

- Ưu tiên giữ chi tiết shard hơn tăng độ sáng.
- Quan sát screenshot: nếu tâm bị clip trắng hoặc các vòng hòa vào nhau, giảm
  strength/exposure trước.
- `balanced` giảm độ phân giải composer hoặc bloom strength.
- `low` tắt `UnrealBloomPass`; có thể dùng một sprite radial nhỏ, sinh bằng
  canvas, additive blending, `depthWrite = false`.
- Glow pulse chỉ thay đổi rất nhẹ, khoảng ±3–4% opacity hoặc scale.
- Không gọi bloom post-processing là “bloom vật lý”.

## 9. Chuyển động không phụ thuộc FPS

Mọi tốc độ phải dùng `deltaSeconds` từ `THREE.Clock` hoặc timestamp:

```js
rotation += angularSpeedRadiansPerSecond * deltaSeconds;
```

Không dùng:

```js
rotation += 0.004;
```

Damping pointer phải độc lập FPS, ví dụ:

```js
const alpha = 1 - Math.exp(-damping * deltaSeconds);
current += (target - current) * alpha;
```

Motion:

- Global Y rotation khoảng `0.08–0.10 rad/s`.
- Core rotation chậm hơn global.
- Ring speed bắt đầu theo bảng ở trên và được tinh chỉnh để khớp video.
- Không animate layout CSS. Với DOM overlay, chỉ animate `transform` và
  `opacity`.
- Khi tab `document.hidden`, ngừng render và reset clock khi quay lại để không
  xuất hiện một delta rất lớn.
- Có thể dừng hoặc giảm render khi section không nằm trong viewport.

## 10. Tương tác

- Pointer drag xoay group quanh X/Y.
- Dùng Pointer Events cho cả mouse, pen và touch.
- Dùng pointer capture khi drag và giải phóng đúng ở `pointerup`,
  `pointercancel`.
- Clamp rotation X để không lật cảnh khó kiểm soát.
- Hover/parallax rất nhẹ, giới hạn khoảng `0.06–0.10` rad.
- Trong lúc drag, giảm hoặc tạm dừng auto-rotation; sau khi thả, trở lại mềm.
- Zoom camera có giới hạn tương đương `z ∈ [7, 22]`.
- Chỉ `preventDefault()` cho wheel khi pointer đang ở vùng canvas tương tác và
  zoom thực sự được xử lý; không cướp scroll của phần còn lại.
- Trên mobile, gesture dọc thông thường phải vẫn cuộn trang; drag reactor chỉ
  kích hoạt sau khi tương tác bắt đầu rõ ràng trong vùng 3D.
- Không dùng OrbitControls nếu nó khiến interaction và responsive khó kiểm soát;
  nếu dùng, phải cấu hình damping, clamp và cleanup đầy đủ.

## 11. Adaptive quality

Định nghĩa ba profile gần đầu script:

```js
const QUALITY_PROFILES = {
  high: {
    coreCount: 2600,
    ringScale: 1,
    maxDpr: 1.75,
    bloom: true,
    bloomResolutionScale: 1,
    backgroundDust: 360
  },
  balanced: {
    coreCount: 1800,
    ringScale: 0.72,
    maxDpr: 1.35,
    bloom: true,
    bloomResolutionScale: 0.65,
    backgroundDust: 180
  },
  low: {
    coreCount: 1050,
    ringScale: 0.48,
    maxDpr: 1,
    bloom: false,
    bloomResolutionScale: 0,
    backgroundDust: 0
  }
};
```

Đây là starting values. Được phép chỉnh nhẹ sau khi đo, nhưng mỗi profile phải
giữ nguyên ba vành, palette và silhouette cơ bản.

Chọn profile ban đầu bằng viewport, `devicePixelRatio`,
`navigator.hardwareConcurrency` và `navigator.deviceMemory` khi có. Không phụ
thuộc hoàn toàn vào user agent.

Cho phép override để kiểm thử:

```text
?quality=high
?quality=balanced
?quality=low
```

Sau warm-up, đo rolling FPS trong khoảng đủ dài để tránh phản ứng với một frame
chậm đơn lẻ. Nếu hiệu năng thấp hơn ngưỡng trong nhiều cửa sổ liên tiếp, chỉ hạ
một bậc. Không tự nâng lại trong cùng session và không dao động profile liên
tục.

Khi đổi profile:

- Tái tạo đúng các mesh cần thiết hoặc khởi tạo profile trước lần render đầu.
- Dispose tài nguyên cũ.
- Không để trùng event listener, renderer hoặc animation loop.
- Không để layout, camera hoặc màu thay đổi đột ngột ngoài mức cần thiết.

## 12. Responsive

Kiểm tra tối thiểu:

```text
1440 × 900
1024 × 768
390 × 844
```

### 1440 × 900

- Giữ split composition.
- Reactor lệch phải, không che heading.
- Ba vành nằm trọn khung và có negative space.
- Chất lượng hình phải gần video Opus 5 nhất.

### 1024 × 768

- Vẫn ưu tiên split nhưng giảm typography và metric density.
- Giảm nhẹ scale/reposition reactor; không chỉ thu nhỏ toàn bộ bằng CSS.
- Nav có thể ẩn bớt menu giữa nhưng giữ brand và system state.

### 390 × 844

- Chuyển sang bố cục dọc có chủ ý.
- Nội dung ở trên, reactor trong vùng riêng phía dưới hoặc làm nền có mask rõ.
- Heading, mô tả và reactor không đè nhau.
- Rút gọn metric grid còn những số quan trọng hoặc chuyển thành hàng cuộn,
  nhưng không tạo horizontal page overflow.
- Camera, FOV, group position và scale có cấu hình mobile riêng.
- Không đơn thuần giữ `atom.position.x = 2.4` của desktop.

## 13. Accessibility và resilience

- Canvas là hình minh họa, đặt accessibility semantics phù hợp, ví dụ
  `aria-hidden="true"` nếu toàn bộ nội dung đã có trong DOM.
- Nội dung chữ phải tồn tại và đọc được khi WebGL không chạy.
- Nếu tạo renderer/composer thất bại, hiển thị fallback tĩnh trang nhã; không để
  trang trắng hoặc exception chưa xử lý.
- Hỗ trợ:

  ```css
  @media (prefers-reduced-motion: reduce)
  ```

- Reduced motion:
  - Dừng auto-rotation, ring rotation, parallax và pulse.
  - Giữ bố cục tĩnh đẹp ở góc mặc định.
  - Cho phép opacity transition ngắn nếu cần.
  - Không xóa nội dung hoặc làm biến mất reactor.
- Focus indicator rõ cho bất kỳ control thật nào.
- Dùng `100svh` với fallback phù hợp, tránh lỗi thanh địa chỉ mobile.
- Cleanup đầy đủ renderer, composer, geometry, materials, textures,
  animation frame, observers và event listeners trong `dispose()`.

## 14. Tiêu chí chất lượng và hiệu năng

Mục tiêu:

- Gần 60 FPS trên laptop phổ thông hiện tại ở `balanced`.
- Tối thiểu khoảng 30 FPS trên điện thoại phổ thông hiện tại ở `low`.
- Không khẳng định đạt FPS nếu chưa đo; báo rõ môi trường đo.
- Không lỗi hoặc warning ứng dụng trong console.
- Không tạo garbage lớn mỗi frame: tái sử dụng `Object3D`, matrix, vector,
  quaternion và color tạm.
- Không gọi `setMatrixAt()` cho toàn bộ instance mỗi frame nếu chỉ cần xoay
  group/mesh.
- Không animate CSS layout properties.
- Renderer và composer resize đúng, không kéo giãn hoặc mờ bất thường.
- Pixel ratio được cap theo profile.
- Không có flash trắng khi load.
- First meaningful frame phải xuất hiện sớm; có thể dùng fade-in opacity ngắn
  sau khi scene sẵn sàng.

## 15. Quy trình triển khai bắt buộc

1. Phân tích video và ghi lại ngắn gọn các đặc điểm của phần Opus 5.
2. Lập một checklist nội bộ từ prompt này.
3. Tạo `ai-factory-atom.html`.
4. Chạy bằng local static server.
5. Mở trong browser và kiểm tra console.
6. Chụp/quan sát screenshot tại 1440×900, 1024×768 và 390×844.
7. So sánh screenshot desktop với phần Opus 5 của video:
   - vị trí và tỷ lệ reactor;
   - độ đặc của lõi;
   - silhouette ba vành;
   - độ rõ của shard;
   - mức bloom;
   - vùng đen và bố cục chữ.
8. Sửa ít nhất một vòng dựa trên quan sát thực tế; không chỉ đọc code rồi kết
   luận.
9. Kiểm tra `?quality=high`, `balanced`, `low`.
10. Kiểm tra reduced motion.
11. Kiểm tra drag, pointer cancel, zoom clamp, resize và tab visibility.
12. Chỉ bàn giao sau khi không còn lỗi runtime.

Nếu môi trường không cho phép screenshot hoặc đo FPS, vẫn hoàn thành file nhưng
phải nói rõ phần nào chưa thể xác minh; không được bịa kết quả.

## 16. Tiêu chí nghiệm thu

Sản phẩm đạt yêu cầu khi:

- Ấn tượng đầu tiên ở desktop giống bản Opus 5 trong video: lõi sáng bằng shard,
  ba vành kim loại đan chéo, vật thể lệch phải, nền đen điện ảnh và khối chữ
  tiết chế bên trái.
- Ở góc mặc định, người xem nhận ra ngay reactor/atom ba chiều; không giống một
  đám mây particle vô định hình.
- Khi xoay khoảng 90°, các vành mỏng đi rồi mở lại, chứng minh cấu trúc 3D thật.
- Bloom tạo năng lượng nhưng vẫn nhìn thấy texture shard.
- Chuyển động có cùng tốc độ cảm nhận trên 60/120/144 Hz vì dùng delta time.
- Reload tạo lại cùng một cấu trúc nhờ seeded random.
- Ba profile giữ cùng art direction và silhouette.
- Mobile có bố cục được art-direct riêng, không phải desktop bị thu nhỏ.
- Reduced-motion vẫn là một composition hoàn chỉnh.
- Page usable khi WebGL thất bại.
- Không có nhãn so sánh, giá hoặc thời gian từ khung video.

## 17. Cách trả lời khi hoàn thành

Trong câu trả lời cuối:

1. Nêu đường dẫn file đã tạo.
2. Tóm tắt tối đa 6 quyết định triển khai quan trọng.
3. Liệt kê các viewport/profile đã kiểm tra và kết quả thực tế.
4. Nêu FPS cùng môi trường đo nếu có.
5. Nêu bất kỳ giới hạn nào chưa xác minh.
6. Không dán lại toàn bộ source nếu file đã được tạo trong workspace.

