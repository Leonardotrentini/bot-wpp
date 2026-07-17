/**
 * Script de atribuição LP → Vesto (rotacionador sequencial via config do servidor).
 * Uso: <script src="https://SEU_BACKEND/vesto-attribution.js?key=vpk_..." defer></script>
 */
(function () {
  "use strict"

  var script = document.currentScript
  if (!script) return

  var key = script.getAttribute("data-vesto-key") || ""
  if (!key) {
    try {
      var scriptUrl = new URL(script.src || "")
      key = scriptUrl.searchParams.get("key") || ""
    } catch (e) {}
  }

  var apiBase = (script.getAttribute("data-api") || "").replace(/\/+$/, "")
  var whatsapp = String(script.getAttribute("data-whatsapp") || "").replace(/\D/g, "")
  var waMsg = script.getAttribute("data-whatsapp-msg") || ""
  var sellers = []
  var rotatorMode = "sequential"
  var pixelId = ""

  if (!apiBase) {
    try {
      var src = script.src || ""
      var u = new URL(src)
      apiBase = u.origin + "/api"
    } catch (e) {
      apiBase = "/api"
    }
  }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"))
    return m ? decodeURIComponent(m[1]) : null
  }

  function resolveAdvancedMatchingEmail() {
    var fromAttr = script.getAttribute("data-email")
    if (fromAttr && fromAttr.indexOf("@") > 0) {
      return String(fromAttr).trim().toLowerCase()
    }
    var el = document.querySelector("[data-vesto-email]")
    if (el) {
      var v = el.value || el.getAttribute("data-vesto-email") || el.textContent || ""
      if (v && String(v).indexOf("@") > 0) return String(v).trim().toLowerCase()
    }
    return null
  }

  function captureMeta() {
    var params = new URLSearchParams(window.location.search)
    var fbclid = params.get("fbclid")
    var fbp = getCookie("_fbp")
    var fbc = getCookie("_fbc")
    if (!fbc && fbclid) {
      // Meta exige creationTime em milissegundos no fbc
      fbc = "fb.1." + Date.now() + "." + fbclid
      document.cookie = "_fbc=" + encodeURIComponent(fbc) + "; path=/; max-age=7776000; SameSite=Lax"
    }
    var meta = {
      fbclid: fbclid,
      fbc: fbc,
      fbp: fbp,
      clickAt: Date.now(),
      pageUrl: window.location.href,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
      utm_term: params.get("utm_term") || "",
      email: resolveAdvancedMatchingEmail(),
    }
    try {
      sessionStorage.setItem("vesto_meta", JSON.stringify(meta))
    } catch (e) {}
    return meta
  }

  function buildRef() {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    var suffix = ""
    for (var i = 0; i < 8; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
    return "vst_" + suffix
  }

  function buildContactEventId(ref) {
    return "vst_contact_" + String(ref || "").toLowerCase()
  }

  function sendAttribution(meta, ref, contactEventId) {
    if (!key) return Promise.resolve()
    var body = {
      vestoPublicKey: key,
      ref: ref,
      fbclid: meta.fbclid,
      fbc: meta.fbc,
      fbp: meta.fbp,
      clickAt: meta.clickAt,
      pageUrl: meta.pageUrl,
      userAgent: meta.userAgent,
      contactEventId: contactEventId,
      email: meta.email || undefined,
      utm_source: meta.utm_source,
      utm_medium: meta.utm_medium,
      utm_campaign: meta.utm_campaign,
      utm_content: meta.utm_content,
      utm_term: meta.utm_term,
    }
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null
    var timer = ctrl ? setTimeout(function () { ctrl.abort() }, 4000) : null
    return fetch(apiBase + "/public/meta/attribution?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Vesto-Key": key },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
      credentials: "omit",
    })
      .catch(function () {})
      .finally(function () {
        if (timer) clearTimeout(timer)
      })
  }

  function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "")
  }

  function pickRotatorPhone() {
    if (!sellers.length) return whatsapp
    if (rotatorMode !== "sequential") {
      return normalizePhone(sellers[0].phone || sellers[0])
    }
    var storageKey = "vesto_seq_" + key
    var idx = 0
    try {
      idx = parseInt(localStorage.getItem(storageKey) || "0", 10) || 0
    } catch (e) {
      idx = 0
    }
    var entry = sellers[idx % sellers.length]
    var phone = normalizePhone(entry && (entry.phone || entry))
    var next = (idx + 1) % sellers.length
    try {
      localStorage.setItem(storageKey, String(next))
    } catch (e) {}
    return phone || whatsapp
  }

  function resolvePhone(target, opts) {
    opts = opts || {}
    if (opts.whatsapp) return normalizePhone(opts.whatsapp)
    if (target && target.getAttribute) {
      var attr = target.getAttribute("data-whatsapp")
      if (attr) return normalizePhone(attr)
    }
    return pickRotatorPhone()
  }

  function trackPixelContact(contactEventId, meta) {
    if (typeof window.fbq !== "function") return
    try {
      var advanced = {}
      if (meta && meta.email) advanced.em = meta.email
      if (meta && meta.fbp) advanced.fbp = meta.fbp
      if (pixelId && Object.keys(advanced).length) {
        window.fbq("init", pixelId, advanced)
      }
      window.fbq("track", "Contact", {}, { eventID: contactEventId })
    } catch (e) {}
  }

  function handleWhatsAppClick(ev, opts) {
    if (ev && ev.preventDefault) ev.preventDefault()
    var meta = captureMeta()
    var ref = buildRef()
    var contactEventId = buildContactEventId(ref)
    trackPixelContact(contactEventId, meta)
    try {
      sessionStorage.setItem("vesto_ref", ref)
      sessionStorage.setItem("vesto_contact_event_id", contactEventId)
    } catch (e) {}
    var target = ev && ev.currentTarget ? ev.currentTarget : null
    var phone = resolvePhone(target, opts)
    if (!phone) return
    var msg = waMsg || "Olá! Vim pelo site e quero mais informações."
    var text = encodeURIComponent(msg)
    // Espera o POST (timeout curto) antes do wa.me — mensagem continua limpa (sem vst_).
    Promise.race([
      sendAttribution(meta, ref, contactEventId),
      new Promise(function (resolve) {
        setTimeout(resolve, 2500)
      }),
    ]).finally(function () {
      window.open("https://wa.me/" + phone + "?text=" + text, "_blank", "noopener,noreferrer")
    })
  }

  captureMeta()

  var selector = script.getAttribute("data-selector") || "[data-vesto-whatsapp]"
  function bind() {
    var nodes = document.querySelectorAll(selector)
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener("click", handleWhatsAppClick)
    }
    window.vestoOpenWhatsApp = function (ev, opts) {
      handleWhatsAppClick(ev || { preventDefault: function () {} }, opts || {})
    }
    window.vestoPickWhatsApp = pickRotatorPhone
  }

  function applyConfig(cfg) {
    if (!cfg) return
    if (!whatsapp && cfg.whatsapp) whatsapp = normalizePhone(cfg.whatsapp)
    if (!waMsg && cfg.whatsappMsg) waMsg = cfg.whatsappMsg
    if (Array.isArray(cfg.sellers) && cfg.sellers.length) sellers = cfg.sellers
    if (cfg.rotatorMode) rotatorMode = cfg.rotatorMode
    if (cfg.pixelId) pixelId = String(cfg.pixelId)
  }

  function loadConfig() {
    if (!key) return Promise.resolve()
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null
    var timer = ctrl ? setTimeout(function () { ctrl.abort() }, 4000) : null
    return fetch(apiBase + "/public/meta/config?key=" + encodeURIComponent(key), {
      method: "GET",
      credentials: "omit",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) return null
        return res.json()
      })
      .then(applyConfig)
      .catch(function () {})
      .finally(function () {
        if (timer) clearTimeout(timer)
      })
  }

  function start() {
    loadConfig().then(bind)
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start)
  } else {
    start()
  }
})()
