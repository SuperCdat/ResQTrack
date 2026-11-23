const I18N = {
  vi: {
    doc_title: "ResQTrack - Điều phối cấp cứu",
    live: "Trực tiếp",
    section_title: "Các xe cứu thương sẵn sàng:",
    locate_auto: "Tự động định vị",
    locate_manual: "Chọn thủ công",
    tt_zoom_in: "Phóng to",
    tt_zoom_out: "Thu nhỏ",
    tt_theme: "Đổi giao diện sáng/tối",
    tt_lang: "Chuyển sang tiếng Anh",
    lang_btn: "EN",
    info_select_title: "Chọn một xe cứu thương",
    phone_placeholder: "Sđt: ---",
    phone_label: "Sđt: {phone}",
    phone_none: "Chưa có số điện thoại",
    call_now: "📞 Gọi ngay",
    eta_idle: "⏱️ Đang tính toán đường đi...",
    eta_calculating: "Đang tính toán tuyến đường...",
    eta_detail:
      "⏱️ Dự kiến: <b>{min} phút</b> | 📏 Khoảng cách: <b>{km} km</b>" +
      '<br><small style="opacity: 0.75;">' +
      "(Thời gian ước tính, chưa có dữ liệu giao thông trực tiếp)</small>",
    card_eta: "⚡ {min} phút ({km} km)",
    card_hint: "Chọn để xem thông tin và tuyến đường",
    card_calculating: "⏳ Đang tính toán...",
    empty_list: "Không tìm thấy xe cứu thương trong khu vực này.",
    default_amb_name: "Xe cứu thương",
    popup_gps: "Bạn đang ở khoảng {m} mét quanh điểm này",
    popup_manual: "Đây là vị trí xuất phát bạn đã chọn thủ công.",
    alert_gps_error:
      "Không thể xác định vị trí của bạn. " +
      "Vui lòng kiểm tra quyền truy cập vị trí hoặc chọn thủ công.",
    alert_need_start:
      "Vui lòng bấm 'Tự động định vị' hoặc 'Chọn thủ công' trước để chọn điểm xuất phát!",
    alert_routing_lib: "Không thể tải thư viện tìm đường. Vui lòng thử lại sau."
  },
  en: {
    doc_title: "ResQTrack - Emergency Dispatch",
    live: "Live",
    section_title: "Available ambulances:",
    locate_auto: "Auto locate",
    locate_manual: "Pick manually",
    tt_zoom_in: "Zoom In",
    tt_zoom_out: "Zoom Out",
    tt_theme: "Toggle Theme",
    tt_lang: "Switch to Vietnamese",
    lang_btn: "VI",
    info_select_title: "Select an ambulance",
    phone_placeholder: "Phone: ---",
    phone_label: "Phone: {phone}",
    phone_none: "No phone number available",
    call_now: "📞 Call now",
    eta_idle: "⏱️ Calculating route...",
    eta_calculating: "Calculating route...",
    eta_detail:
      "⏱️ Estimated: <b>{min} min</b> | 📏 Distance: <b>{km} km</b>" +
      '<br><small style="opacity: 0.75;">' +
      "(Estimated time, no live traffic data)</small>",
    card_eta: "⚡ {min} min ({km} km)",
    card_hint: "Select to view details and route",
    card_calculating: "⏳ Calculating...",
    empty_list: "No ambulances found in this area.",
    default_amb_name: "Ambulance",
    popup_gps: "You are within about {m} meters of this point",
    popup_manual: "This is the starting point you selected manually.",
    alert_gps_error:
      "Unable to determine your location. " +
      "Please check location permissions or pick manually.",
    alert_need_start:
      "Please press 'Auto locate' or 'Pick manually' first to set a starting point!",
    alert_routing_lib: "Could not load the routing library. Please try again later."
  }
};

let currentLang = "vi";

try {
  const saved = localStorage.getItem("resqtrack-lang");
  if (saved === "vi" || saved === "en") currentLang = saved;
} catch (e) {}

function t(key, params = {}) {
  const dict = I18N[currentLang] || I18N.vi;
  let text = dict[key] !== undefined ? dict[key] : (I18N.vi[key] || key);

  Object.keys(params).forEach((p) => {
    text = text.split("{" + p + "}").join(params[p]);
  });

  return text;
}

const PROVINCE_EN = {
  "Cần Thơ": "Can Tho",
  "Hồ Chí Minh": "Ho Chi Minh City",
  "Hà Nội": "Hanoi",
  "Đà Nẵng": "Da Nang"
};

function localizeProvince(name) {
  if (currentLang === "vi") return name;
  return PROVINCE_EN[name] || name;
}

function localizeName(name) {
  if (!name || currentLang === "vi") return name;

  return name
    .replace(/^Xe\s+(\d+)/, "Ambulance $1")
    .replace("Bệnh viện Cho Rẫy - Q5", "Cho Ray Hospital - D5")
    .replace("BV Bạch Mai", "Bach Mai Hospital");
}

function applyStaticTranslations() {
  document.documentElement.lang = currentLang;
  document.title = t("doc_title");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}

function updateLangButton() {
  const btn = document.getElementById("langtoggle");
  if (!btn) return;

  btn.textContent = t("lang_btn");
  btn.title = t("tt_lang");
}

function ToggleLanguage() {
  currentLang = currentLang === "vi" ? "en" : "vi";

  try {
    localStorage.setItem("resqtrack-lang", currentLang);
  } catch (e) {}

  if (typeof refreshLanguageUI === "function") {
    refreshLanguageUI();
  }
}
