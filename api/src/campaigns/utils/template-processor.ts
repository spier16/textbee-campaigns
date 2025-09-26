import { Contact } from '../../contacts/schemas/contact.schema'

/**
 * Interface for contact data used in template processing
 */
export interface ContactData {
  id?: string
  firstName?: string
  lastName?: string
  phone: string
  email?: string
  propertyAddress?: string
  propertyCity?: string
  propertyState?: string
  propertyZip?: string
  mailingAddress?: string
  mailingCity?: string
  mailingState?: string
  mailingZip?: string
}

/**
 * Process template variables in message content by substituting them with contact data
 * @param templateContent The template content with variables like {firstName}
 * @param contact The contact data to substitute variables with
 * @returns The processed content with variables replaced by actual contact data
 */
export function processTemplateVariables(templateContent: string, contact: ContactData): string {
  let processedContent = templateContent

  // Define variable mappings
  const variableMap: Record<string, string> = {
    '{firstName}': contact.firstName || '',
    '{lastName}': contact.lastName || '',
    '{phone}': contact.phone || '',
    '{email}': contact.email || '',
    '{propertyAddress}': contact.propertyAddress || '',
    '{propertyCity}': contact.propertyCity || '',
    '{propertyState}': contact.propertyState || '',
    '{propertyZip}': contact.propertyZip || '',
    '{mailingAddress}': contact.mailingAddress || '',
    '{mailingCity}': contact.mailingCity || '',
    '{mailingState}': contact.mailingState || '',
    '{mailingZip}': contact.mailingZip || '',
    '{fullName}': `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
  }

  // Replace all variables
  Object.entries(variableMap).forEach(([variable, value]) => {
    processedContent = processedContent.replace(new RegExp(variable.replace(/[{}]/g, '\\$&'), 'g'), value)
  })

  return processedContent
}

/**
 * Extract all variables used in a template content
 * @param templateContent The template content to analyze
 * @returns Array of variable names found in the template (without curly braces)
 */
export function extractTemplateVariables(templateContent: string): string[] {
  const variableRegex = /\{([^}]+)\}/g
  const variables: string[] = []
  let match

  while ((match = variableRegex.exec(templateContent)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1])
    }
  }

  return variables
}

/**
 * Validate that all variables in a template have corresponding contact data fields
 * @param templateContent The template content to validate
 * @returns Array of unsupported variable names
 */
export function validateTemplateVariables(templateContent: string): string[] {
  const supportedVariables = [
    'firstName', 'lastName', 'phone', 'email', 'fullName',
    'propertyAddress', 'propertyCity', 'propertyState', 'propertyZip',
    'mailingAddress', 'mailingCity', 'mailingState', 'mailingZip'
  ]

  const usedVariables = extractTemplateVariables(templateContent)
  return usedVariables.filter(variable => !supportedVariables.includes(variable))
}