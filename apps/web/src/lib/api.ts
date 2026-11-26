export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(code);
  }
}

/** fetch al API propio (mismo origen, cookies incluidas). */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `http_${res.status}`, data.detail ?? data.message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Sube un archivo a /api/uploads y devuelve su URL pública. */
export async function uploadFile(file: File): Promise<{ url: string; kind: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body: form, credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      data.error ?? `http_${res.status}`,
      data.maxMb ? `Máximo ${data.maxMb} MB` : undefined,
    );
  }
  return res.json();
}

const MESSAGES: Record<string, string> = {
  datos_invalidos: "Revisa los datos del formulario.",
  rol_insuficiente: "Tu rol no permite esta acción.",
  base_url_requerida: "Este tipo de proveedor necesita una URL base.",
  proveedor_no_existe: "El proveedor seleccionado no existe.",
  disparador_en_uso: "Un disparador ya está asignado a otro producto.",
  ia_no_configurada: "Configura un modelo para «Tareas rápidas» en Modelos de IA.",
  ia_api_key_invalida: "El proveedor de IA rechazó la API key.",
  ia_fallo: "La IA no pudo generar una respuesta válida. Intenta de nuevo.",
  token_invalido: "Chatea Pro rechazó el token.",
  chateapro_no_responde: "Chatea Pro no respondió. Intenta más tarde.",
  tipo_no_permitido: "Tipo de archivo no permitido (usa JPG, PNG, WEBP, MP4, MP3, OGG o PDF).",
  archivo_muy_grande: "El archivo es muy grande.",
  no_existe: "No existe o fue eliminado.",
  whatsapp_token_invalido: "Meta rechazó el token de acceso.",
  whatsapp_app_secret_no_coincide: "El App Secret no es el de la app del token.",
  whatsapp_meta_error: "Meta devolvió un error:",
  numero_ya_conectado: "Ese número ya está conectado (en esta u otra tienda).",
  ventana_cerrada:
    "Pasaron más de 24 h desde el último mensaje del cliente: solo puedes enviar una plantilla.",
  plantilla_no_aprobada: "La plantilla aún no está aprobada por Meta.",
  plantilla_no_existe: "La plantilla no existe en este número.",
  faltan_ejemplos: "Agrega un ejemplo para cada variable {{n}}.",
  telefono_invalido: "Número de teléfono inválido.",
  media_no_disponible: "Meta ya no tiene este archivo disponible.",
  url_privada: "La URL no puede apuntar a una red privada.",
  url_debe_ser_https: "La URL debe empezar con https://",
  dropi_rechazo: "Dropi rechazó la conexión.",
  falta_token: "Pega el token de Dropi.",
  ya_en_dropi: "El pedido ya está en Dropi.",
  no_se_puede: "No se pudo crear el pedido.",
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const base = MESSAGES[e.code] ?? `Error: ${e.code}`;
    if (!e.detail) return base;
    // Mensajes del API ya escritos para el usuario: no repetir el genérico.
    return e.detail.startsWith(base) || e.detail.length > 40 ? e.detail : `${base} ${e.detail}`;
  }
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string")
    return e.message;
  return "Ocurrió un error inesperado.";
}
