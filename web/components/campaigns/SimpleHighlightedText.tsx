'use client'

import { getAllVariablesWithBraces, getVariablesByCategory } from '@/lib/template-variables'

interface SimpleHighlightedTextProps {
  content: string
  className?: string
}

/**
 * Simple component to render text with highlighted template variables
 * Uses shared constants to ensure consistency with API
 * For use in template dialogs where we work with plain strings
 */
export function SimpleHighlightedText({ content, className = '' }: SimpleHighlightedTextProps) {
  const validVariables = getAllVariablesWithBraces()
  const categorizedVariables = getVariablesByCategory()

  // Define colors for each variable category
  const categoryColors = {
    contact: 'text-blue-600 bg-blue-50',
    propertyAddress: 'text-green-600 bg-green-50',
    mailingAddress: 'text-purple-600 bg-purple-50',
    other: 'text-gray-600 bg-gray-50'
  }

  // Function to get the category of a variable
  const getVariableCategory = (variable: string): keyof typeof categoryColors => {
    for (const [category, { variables }] of Object.entries(categorizedVariables)) {
      if (variables.includes(variable)) {
        return category as keyof typeof categoryColors
      }
    }
    return 'other'
  }

  const parts = content.split(/(\{[^}]+\})/g)

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (part.match(/^\{[^}]+\}$/) && validVariables.includes(part)) {
          const category = getVariableCategory(part)
          const colorClasses = categoryColors[category]

          return (
            <span key={index} className={`font-medium px-1 rounded ${colorClasses}`}>
              {part}
            </span>
          )
        }
        return part
      })}
    </span>
  )
}