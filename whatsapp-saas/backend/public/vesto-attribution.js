/**
 * Script de atribuição LP → Vesto (cole via Integrações → Meta).
 * Uso: <script src="https://SEU_BACKEND/vesto-attribution.js" data-vesto-key="vpk_..." ...>
 */
(function () {
  "use strict"

  var script = document.currentScript
  if (!script) return

  var key = script.getAttribute("data-vesto-key") || ""
  var apiBase = (script.getAttribute("data-api") || "").replace(/\/+$/, "")
  var whatsapp = String(script.getAttribute("data-whatsapp") || "").replace(/\D/g, "")
  var waMsg = script.getAttribute("data-whatsapp-msg") || "Olá! Vim pelo site e quero mais informações."

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

  function captureMeta() {
    var params = new URLSearchParams(window.location.search)
    var fbclid = params.get("fbclid")
    var fbp = getCookie("_fbp")
    var fbc = getCookie("_fbc")
    if (!fbc && fbclid) {
      fbc = "fb.1." + Math.floor(Date.now() / 1000) + "." + fbclid
      document.cookie = "_fbc=" + fbc + "; path=/; max-age=7776000; SameSite=Lax"
    }
    var meta = {
      fbclid: fbclid,
      fbc: fbc,
      fbp: fbp,
      clickAt: Date.now(),
      pageUrl: window.location.href,
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
      utm_term: params.get("utm_term") || "",
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

  function sendAttribution(meta, ref) {
    if (!key) return Promise.resolve()
    var body = {
      vestoPublicKey: key,
      ref: ref,
      fbclid: meta.fbclid,
      fbc: meta.fbc,
      fbp: meta.fbp,
      clickAt: meta.clickAt,
      pageUrl: meta.pageUrl,
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

  function handleWhatsAppClick(ev) {
    if (ev && ev.preventDefault) ev.preventDefault()
    if (typeof window.fbq === "function") {
      try {
        window.fbq("track", "Contact")
      } catch (e) {}
    }
    var meta = captureMeta()
    var ref = buildRef()
    try {
      sessionStorage.setItem("vesto_ref", ref)
    } catch (e) {}
    sendAttribution(meta, ref)
    if (!whatsapp) return
    var text = encodeURIComponent(waMsg + "\n\n(" + ref + ")")
    window.open("https://wa.me/" + whatsapp + "?text=" + text, "_blank", "noopener,noreferrer")
  }

  captureMeta()

  var selector = script.getAttribute("data-selector") || "[data-vesto-whatsapp]"
  function bind() {
    var nodes = document.querySelectorAll(selector)
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener("click", handleWhatsAppClick)
    }
    if (!nodes.length && script.getAttribute("data-auto-bind") !== "false") {
      window.vestoOpenWhatsApp = handleWhatsAppClick
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind)
  } else {
    bind()
  }
})()
