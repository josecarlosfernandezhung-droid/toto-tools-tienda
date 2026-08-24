// netlify/functions/firebase-proxy.js
//
// QUÉ HACE ESTO
// -------------
// El navegador del cliente (en Cuba, sin VPN) NUNCA habla directo con
// Firebase — eso es lo que está bloqueado. En vez de eso, le habla a ESTA
// función, que vive en tu mismo dominio de Netlify (ese sí es accesible sin
// VPN). Esta función corre en el SERVIDOR de Netlify (que no tiene el
// bloqueo de Cuba) y es la que de verdad le pregunta a Firebase, y te
// devuelve la respuesta tal cual.
//
// Cliente (Cuba, sin VPN)  --->  tu-sitio.netlify.app/.netlify/functions/firebase-proxy
//                                              |
//                                              v  (esto SÍ sale bien, corre en EEUU/Europa, no en Cuba)
//                                        firebasedatabase.app
//
// CÓMO SE INSTALA
// ----------------
// 1. En tu repo (el mismo que tiene tu index.html), crea la carpeta
//    "netlify/functions/" si no existe, y pon este archivo ahí adentro
//    exactamente con este nombre: firebase-proxy.js
//
// 2. Si tu repo YA tiene un archivo "netlify.toml", ábrelo y asegúrate de
//    que tenga esta línea (agrégala si falta):
//        [functions]
//        directory = "netlify/functions"
//    Si NO tienes netlify.toml, no hace falta crear uno — Netlify detecta
//    la carpeta "netlify/functions" sola.
//
// 3. Sube (commit + push) esto a tu repo de GitHub. Netlify lo despliega
//    solo en el siguiente deploy.
//
// 4. En tu index.html, cambia:
//        usarProxy: false,
//    por:
//        usarProxy: true,
//    (Ya tienes proxyPath configurado, no hace falta tocar eso.)
//
// 5. Prueba SIN VPN. Si algo falla, revisa en Netlify → tu sitio →
//    "Functions" → "firebase-proxy" → los logs te dicen el error exacto.
//
// SEGURIDAD
// ---------
// Solo se permite pasar por aquí lo mínimo que el sitio necesita: leer el
// catálogo, y leer/escribir analítica. Cualquier otra ruta se rechaza con
// 403, para que esto no se convierta en una puerta abierta a cualquier cosa
// de tu base de datos. Aun así, tus REGLAS de Firebase (Realtime Database →
// Rules) siguen siendo la protección real — esto es una capa extra, no un
// reemplazo.

// -----------------------------------------------------------------------
// CONFIGURACIÓN — cambia esto si alguna vez cambias de proyecto de Firebase
// -----------------------------------------------------------------------
const FIREBASE_DB_URL = "https://catalogo-7f269-default-rtdb.europe-west1.firebasedatabase.app";

// Rutas permitidas a través del proxy (whitelist). Cada entrada dice qué
// métodos HTTP se aceptan para esa ruta.
const RUTAS_PERMITIDAS = [
  { patron: /^\/catalogo\.json$/, metodos: ["GET"] },
  { patron: /^\/analitica\.json$/, metodos: ["GET"] },
  { patron: /^\/analitica\/[a-zA-Z0-9_-]+\.json$/, metodos: ["GET", "POST"] },
];

const TIMEOUT_MS = 15000; // si Firebase no contesta en 15s, se corta y se avisa

exports.handler = async (event) => {
  // CORS: normalmente el sitio y la función viven en el mismo dominio, así
  // que esto no hace falta para el uso normal — pero no cuesta nada dejarlo
  // por si algún día pruebas el sitio desde otro origen (ej. localhost).
  const headersComunes = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if(event.httpMethod === "OPTIONS"){
    return { statusCode: 204, headers: headersComunes, body: "" };
  }

  const path = event.queryStringParameters && event.queryStringParameters.path;
  if(!path){
    return respuesta(400, { error: "Falta el parámetro 'path'." }, headersComunes);
  }

  const ruta = RUTAS_PERMITIDAS.find(r => r.patron.test(path));
  if(!ruta){
    return respuesta(403, { error: "Esa ruta no está permitida por este proxy." }, headersComunes);
  }
  if(!ruta.metodos.includes(event.httpMethod)){
    return respuesta(405, { error: `Método ${event.httpMethod} no permitido para esta ruta.` }, headersComunes);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try{
    const opciones = {
      method: event.httpMethod,
      signal: controller.signal,
    };
    if(event.httpMethod === "POST" && event.body){
      opciones.headers = { "Content-Type": "application/json" };
      opciones.body = event.body;
    }

    const res = await fetch(`${FIREBASE_DB_URL}${path}`, opciones);
    clearTimeout(timer);

    const texto = await res.text();
    return {
      statusCode: res.status,
      headers: { ...headersComunes, "Content-Type": "application/json" },
      body: texto,
    };
  }catch(e){
    clearTimeout(timer);
    const esTimeout = e && e.name === "AbortError";
    return respuesta(
      esTimeout ? 504 : 502,
      { error: esTimeout ? "Firebase tardó demasiado en responder." : "No se pudo contactar a Firebase." },
      headersComunes
    );
  }
};

function respuesta(statusCode, objeto, headersComunes){
  return {
    statusCode,
    headers: { ...headersComunes, "Content-Type": "application/json" },
    body: JSON.stringify(objeto),
  };
}
