/**
 * Template variable definitions and constants
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