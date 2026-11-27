// Geometría de las gráficas de Estadísticas: SVG dibujado en el servidor. La CSP no permite `style=""` ni scripts en
// línea, así que los tamaños van como atributos del SVG (como la barra del plazo de radicación). Funciones puras.

/** Un tope «redondo» para el eje (1, 2, 2,5 o 5 × 10ⁿ) y el paso de sus líneas guía. */
export function escalaRedonda(maximo, lineas = 4) {
  if (!(maximo > 0)) return { tope: lineas, paso: 1 };
  const bruto = maximo / lineas;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto);
  return { tope: paso * lineas, paso };
}

/** Trazo de una barra con las esquinas de arriba redondeadas y la base recta, apoyada en el eje. */
export function barraRedondeada(x, y, ancho, alto, radio = 4) {
  if (alto <= 0) return '';
  const r = Math.min(radio, ancho / 2, alto);
  const n = (v) => Math.round(v * 100) / 100;
  return (
    `M${n(x)},${n(y + alto)}V${n(y + r)}Q${n(x)},${n(y)} ${n(x + r)},${n(y)}` +
    `H${n(x + ancho - r)}Q${n(x + ancho)},${n(y)} ${n(x + ancho)},${n(y + r)}V${n(y + alto)}Z`
  );
}

/**
 * Columnas verticales de una sola serie (una por mes). Devuelve las medidas para dibujarlas en un viewBox fijo.
 * Las etiquetas de valor solo van en el máximo y en el último punto (etiquetas selectivas).
 * @param {{ etiqueta: string, valor: number }[]} puntos
 * @param {{ ancho?: number, alto?: number, formato?: (n: number) => string }} opciones
 */
export function columnas(puntos, { ancho = 560, alto = 200, formato = String } = {}) {
  const margen = { arriba: 18, derecha: 4, abajo: 22, izquierda: 44 };
  const area = { x: margen.izquierda, y: margen.arriba, ancho: ancho - margen.izquierda - margen.derecha, alto: alto - margen.arriba - margen.abajo };
  const maximo = Math.max(0, ...puntos.map((p) => p.valor));
  const { tope, paso } = escalaRedonda(maximo);
  const banda = puntos.length ? area.ancho / puntos.length : area.ancho;
  const grosor = Math.min(28, banda * 0.56);
  const yDe = (v) => area.y + area.alto - (v / tope) * area.alto;
  const iMaximo = maximo > 0 ? puntos.findIndex((p) => p.valor === maximo) : -1;
  // Con muchos meses, las etiquetas del eje se alternan para no encimarse.
  const cadaCuanto = puntos.length > 12 ? Math.ceil(puntos.length / 12) : 1;

  const guias = [];
  for (let v = 0; v <= tope + paso / 2; v += paso) guias.push({ y: yDe(v), texto: formato(v), base: v === 0 });

  const barras = puntos.map((p, i) => {
    const x = area.x + banda * i + (banda - grosor) / 2;
    const y = yDe(p.valor);
    const etiquetada = p.valor > 0 && (i === iMaximo || i === puntos.length - 1);
    return {
      ...p,
      d: barraRedondeada(x, y, grosor, area.y + area.alto - y),
      // El área sensible ocupa toda la banda, más grande que la barra.
      zona: { x: area.x + banda * i, y: area.y, ancho: banda, alto: area.alto },
      centro: x + grosor / 2,
      yValor: y - 5,
      etiquetada,
      textoValor: formato(p.valor),
      conEtiquetaEje: i % cadaCuanto === 0,
    };
  });

  return { ancho, alto, area, guias, barras, yEje: alto - 6 };
}

/** Porcentaje entero (0-100) de `valor` sobre `total`, para el ancho de una barra horizontal. Nunca 0 si hay valor. */
export function anchoRelativo(valor, total) {
  if (!(total > 0) || !(valor > 0)) return 0;
  return Math.max(1.5, Math.round((valor / total) * 1000) / 10);
}
