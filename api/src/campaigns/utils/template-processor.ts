import { Contact } from '../../contacts/schemas/contact.schema'
import { SUPPORTED_TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_CATEGORIES } from '../constants/template-variables'

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
 * Interface for a highlighted text segment
 */
export interface HighlightedSegment {
  text: string
  isVariable: boolean
  variableName?: string
  variableType?: string
}

/**
 * Interface for validation error information
 */
export interface ValidationError {
  variableName: string
  errorType: 'missing_field' | 'empty_value' | 'unsupported_variable'
  message: string
}

/**
 * Interface for highlighted content structure
 */
export interface HighlightedContent {
  segments: HighlightedSegment[]
  plainText: string
  validationErrors?: ValidationError[]
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
  const supportedVariables = SUPPORTED_TEMPLATE_VARIABLES

  const usedVariables = extractTemplateVariables(templateContent)
  return usedVariables.filter(variable => !supportedVariables.includes(variable as any))
}

/**
 * Get the variable type/category for highlighting purposes
 * @param variableName The variable name (without braces)
 * @returns The variable type category
 */
export function getVariableType(variableName: string): string {
  // Check each category for the variable
  for (const [categoryKey, category] of Object.entries(TEMPLATE_VARIABLE_CATEGORIES)) {
    if ((category.variables as readonly string[]).includes(variableName)) {
      return categoryKey
    }
  }
  return 'other'
}

/**
 * Process template variables with highlighting information
 * @param templateContent The template content with variables like {firstName}
 * @param contact The contact data to substitute variables with
 * @returns Highlighted content structure with segments and plain text
 */
export function processTemplateVariablesWithHighlighting(
  templateContent: string,
  contact: ContactData
): HighlightedContent {
  const segments: HighlightedSegment[] = []
  const validationErrors: ValidationError[] = []
  let currentPosition = 0

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

  // Define supported variables for validation
  const supportedVariables = SUPPORTED_TEMPLATE_VARIABLES

  // Find all variable occurrences with their positions
  const variableRegex = /\{([^}]+)\}/g
  const matches: Array<{ match: RegExpExecArray; variable: string; value: string }> = []

  let match
  while ((match = variableRegex.exec(templateContent)) !== null) {
    const variableWithBraces = match[0]
    const variableName = match[1]
    let value = ''

    // Check if variable is supported
    if (!supportedVariables.includes(variableName)) {
      validationErrors.push({
        variableName,
        errorType: 'unsupported_variable',
        message: `Variable '${variableName}' is not supported. Supported variables: ${supportedVariables.join(', ')}`
      })
    } else {
      value = variableMap[variableWithBraces] || ''

      // Check if value is empty
      if (!value || value.trim() === '') {
        validationErrors.push({
          variableName,
          errorType: 'empty_value',
          message: `Variable '${variableName}' has no value for this contact`
        })
      }
    }

    matches.push({
      match,
      variable: variableName,
      value
    })
  }

  // Process the template content segment by segment
  for (let i = 0; i < matches.length; i++) {
    const { match, variable, value } = matches[i]

    // Add any plain text before this variable
    if (match.index > currentPosition) {
      const plainText = templateContent.slice(currentPosition, match.index)
      if (plainText.length > 0) {
        segments.push({
          text: plainText,
          isVariable: false
        })
      }
    }

    // Add the variable segment
    segments.push({
      text: value,
      isVariable: true,
      variableName: variable,
      variableType: getVariableType(variable)
    })

    currentPosition = match.index + match[0].length
  }

  // Add any remaining plain text after the last variable
  if (currentPosition < templateContent.length) {
    const remainingText = templateContent.slice(currentPosition)
    if (remainingText.length > 0) {
      segments.push({
        text: remainingText,
        isVariable: false
      })
    }
  }

  // If no variables were found and no segments added yet, treat the entire content as plain text
  if (matches.length === 0 && segments.length === 0) {
    segments.push({
      text: templateContent,
      isVariable: false
    })
  }

  // Generate plain text version for compatibility
  const plainText = segments.map(segment => segment.text).join('')

  return {
    segments,
    plainText,
    validationErrors: validationErrors.length > 0 ? validationErrors : undefined
  }
}