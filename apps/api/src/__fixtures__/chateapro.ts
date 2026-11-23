import type { BotField } from "../services/chateapro-import.js";

/** Recorte real del workspace VitashopEc (docs/referencia-chateapro), textos abreviados. */
export const megaRedSlot = {
  activadores_del_flujo: {
    ids_de_anuncio: "120250514665380388,120250514665360388,,,,",
    palabras_clave: "Hola 👋 me interesa el Mega Red 💪,Mega Red,,,,,",
  },
  embudo_de_ventas: {
    mensaje_inicial: "🥵*MEGARED OMEGA-3 KRILL OIL*",
    multimedia: [
      "https://media.chateapro.app/temp/x/megared4.png",
      "https://media.chateapro.app/temp/x/megared7.mp4",
      "https://media.chateapro.app/temp/x/audiomegared.mp3",
    ],
    pregunta_de_entrada: "📍 ¿Desde qué ciudad nos escribes?",
  },
  informacion_de_producto: {
    estado: "activo",
    id_dropi: "148700",
    imagen: "https://media.chateapro.app/temp/x/megared1.jpeg",
    moneda: "USD",
    nombre: "Mega Red",
    precio: "27.99",
    tipo: "físico",
    variable: "SIMPLE",
  },
  prompt: {
    prompt_guiado_contextualizacion: "",
    prompt_libre: "ROL: Carlos, asesor de ventas de MegaRed en Ecuador.",
    tipo_de_prompt: "libre",
  },
  recordatorios: {
    activar_1: "si",
    activar_2: "si",
    mensaje_1: "💪Iniciemos el tratamiento hoy mismo!",
    mensaje_2: "👉 Confirma ahora tu pedido",
    tiempo_1: "1 horas",
    tiempo_2: "5 horas",
  },
  remarketing: {
    activar_1: "no",
    activar_2: "si",
    plantilla_1: { lang: "es", name: "no enviar plantilla", namespace: "" },
    plantilla_2: { lang: "es", name: "remarketing_megared", namespace: "" },
    prompt_1: "",
    prompt_2: "",
    tiempo_1: "3 dias",
    tiempo_2: "5 dias",
  },
  upsells: {
    "1": { activo: "no", nombre: "", precio: "" },
    "2": {
      activo: "si",
      nombre: "Batana Oil",
      precio: "15",
      momento: "compra realizada",
      titulo: "Para tu cabello",
    },
  },
};

export const workspaceFields: BotField[] = [
  { name: "[Producto Ventas Wp] 1", var_type: "array", value: JSON.stringify(megaRedSlot) },
  {
    name: "[Producto Ventas Wp] 2",
    var_type: "array",
    value: JSON.stringify({
      informacion_de_producto: {
        nombre: "BioKids Moringa",
        precio: "24,90",
        estado: "inactivo",
        tipo: "físico",
      },
      prompt: {
        tipo_de_prompt: "guiado",
        prompt_guiado_ficha_tecnica: "Gomitas de moringa",
        prompt_guiado_reglas: "No prometas curas",
      },
      embudo_de_ventas: { multimedia: { "1": "https://x/a.webp", "2": "" } },
    }),
  },
  {
    name: "[Producto Ventas Wp] 3",
    var_type: "array",
    value: JSON.stringify({ informacion_de_producto: { nombre: "" } }),
  },
  {
    name: "[Ventas Wp] Disparador de productos Extendido",
    var_type: "longtext",
    value: JSON.stringify([
      {
        producto: "Mega Red",
        name: "[Producto Ventas Wp] 1",
        keyW: "Mega Red,MegaRed,,",
        idAd: "120250514665370388,,",
        estado: "activo",
      },
    ]),
  },
  {
    name: "[Ventas Wp] Configuracion general 2",
    var_type: "array",
    value: JSON.stringify({
      comportamiento_ia: {
        division: { cantidad: "varios", limite: "5" },
        rol: "Sé humano.",
        restricciones: "1. No repitas datos.",
      },
    }),
  },
  {
    name: "[Ventas Wp] Configuracion general",
    var_type: "array",
    value: JSON.stringify({ producto_segundos: { prompt_prompt: "Asesor: {{nombre_asesor}}" } }),
  },
  { name: "[Confio] Token", var_type: "text", value: "secreto" },
];
