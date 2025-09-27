/**
 * Template variable definitions and constants for frontend use
 * Note: Keep this in sync with api/src/campaigns/constants/template-variables.ts
 */

/**
 * List of all supported template variables
 * These correspond to fields in the Contact schema that can be used in message templates
 */
export const SUPPORTED_TEMPLATE_VARIABLES = [
  'firstName',
  'lastName',
  'phone',
  'email',
  'fullName',
  'propertyAddress',
  'propertyCity',
  'propertyState',
  'propertyZip',
  'mailingAddress',
  'mailingCity',
  'mailingState',
  'mailingZip'
] as const

/**
 * Template variables organized by category for better UI display
 */
export const TEMPLATE_VARIABLE_CATEGORIES = {
  contact: {
    label: 'Contact Info',
    variables: ['firstName', 'lastName', 'fullName', 'phone', 'email']
  },
  propertyAddress: {
    label: 'Property Address',
    variables: ['propertyAddress', 'propertyCity', 'propertyState', 'propertyZip']
  },
  mailingAddress: {
    label: 'Mailing Address',
    variables: ['mailingAddress', 'mailingCity', 'mailingState', 'mailingZip']
  }
} as const

/**
 * Type definition for supported template variables
 */
export type SupportedTemplateVariable = typeof SUPPORTED_TEMPLATE_VARIABLES[number]

/**
 * Format variables for display in the UI
 * @returns Formatted string with all variables grouped by category
 */
export function formatVariablesForDisplay(): string {
  const categoryStrings = Object.values(TEMPLATE_VARIABLE_CATEGORIES).map(category => {
    const variableList = category.variables.map(variable => `{${variable}}`).join(', ')
    return `**${category.label}**: ${variableList}`
  })

  return categoryStrings.join(' • ')
}

/**
 * Get all variables as a flat array with curly braces for display
 * @returns Array of variables with curly braces (e.g., ['{firstName}', '{lastName}'])
 */
export function getAllVariablesWithBraces(): string[] {
  return SUPPORTED_TEMPLATE_VARIABLES.map(variable => `{${variable}}`)
}

/**
 * Get variables grouped by category with curly braces
 * @returns Object with categories containing arrays of variables with braces
 */
export function getVariablesByCategory(): Record<string, { label: string; variables: string[] }> {
  return Object.fromEntries(
    Object.entries(TEMPLATE_VARIABLE_CATEGORIES).map(([key, category]) => [
      key,
      {
        label: category.label,
        variables: category.variables.map(variable => `{${variable}}`)
      }
    ])
  )
}