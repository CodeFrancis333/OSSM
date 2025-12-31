// Simple NSCP-like validator utilities
// Exports validation helpers used by the SectionEditor.

/**
 * Validate rebar spacing against detailing rules.
 * @param {{ diaMm: number, spacingMm: number, detailing: object }} opts
 * @returns {string[]} array of error messages (empty if ok)
 */
export function validateSpacing({ diaMm, spacingMm, detailing }){
  const errors = []
  const sMinRaw = detailing && detailing.S_min_mm
  const sMin = Number(sMinRaw)
  const spacing = Number(spacingMm)
  const dia = Number(diaMm)
  const sMinFinal = isNaN(sMin) ? 25 : sMin
  if (isNaN(spacing)){
    errors.push('Invalid spacing')
    return errors
  }
  if (spacing < sMinFinal) errors.push(`Spacing ${spacing}mm < S_min ${sMinFinal}mm`)
  if (!isNaN(dia) && spacing < dia) errors.push(`Spacing ${spacing}mm < bar dia ${dia}mm`)
  return errors
}

/**
 * Parse a diameter label like '16mm' to numeric mm.
 */
export function parseDiaLabel(label){
  if (!label) return 0
  const n = Number(String(label).replace(/[^0-9.]/g,''))
  return isNaN(n) ? 0 : n
}

export default { validateSpacing, parseDiaLabel }
