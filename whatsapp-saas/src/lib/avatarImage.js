/** Tamanho final do avatar e limite alinhado ao backend (~1M chars em base64). */
export const AVATAR_OUTPUT_SIZE = 256
export const AVATAR_MAX_DATA_URL_LENGTH = 900_000
export const AVATAR_MAX_INPUT_BYTES = 5 * 1024 * 1024

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('LOAD_FAILED'))
    }
    img.src = url
  })
}

/** Recorta e redimensiona para quadrado JPEG, mantendo abaixo do limite da API. */
export async function resizeAvatarFile(file) {
  const img = await loadImageFromFile(file)
  const size = AVATAR_OUTPUT_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_FAILED')

  const scale = Math.max(size / img.width, size / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)

  let quality = 0.88
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > AVATAR_MAX_DATA_URL_LENGTH && quality > 0.45) {
    quality -= 0.08
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > AVATAR_MAX_DATA_URL_LENGTH) {
    throw new Error('TOO_LARGE')
  }
  return dataUrl
}
