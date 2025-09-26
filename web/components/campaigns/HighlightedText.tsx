'use client'

import React, { useEffect } from 'react'
import { cn } from '@/lib/utils'

// Interface matching the backend ValidationError structure
export interface ValidationError {
  variableName: string
  errorType: 'missing_field' | 'empty_value' | 'unsupported_variable'
  message: string
}

// Interface matching the backend HighlightedSegment structure
export interface HighlightedSegment {
  text: string
  isVariable: boolean
  variableName?: string
  variableType?: string
}

// Interface matching the backend HighlightedContent structure
export interface HighlightedContent {
  segments: HighlightedSegment[]
  plainText: string
  validationErrors?: ValidationError[]
}

interface HighlightedTextProps {
  content: HighlightedContent | string
  className?: string
  showHighlighting?: boolean
  showValidationErrors?: boolean
  onValidationErrors?: (errors: ValidationError[]) => void
}

// Color classes for variable highlighting
const getVariableHighlightClass = (isEmpty?: boolean): string => {
  if (isEmpty) {
    return 'bg-red-100 text-red-800 border border-red-200'
  }

  return 'bg-blue-100 text-blue-800 border border-blue-200'
}


export function HighlightedText({
  content,
  className = '',
  showHighlighting = true,
  showValidationErrors = false,
  onValidationErrors
}: HighlightedTextProps) {
  // Handle validation errors callback
  useEffect(() => {

    if (onValidationErrors) {
      if (typeof content !== 'string' && content.validationErrors) {
        onValidationErrors(content.validationErrors)
      } else {
        // Clear validation errors when content has no errors or is a string
        onValidationErrors([])
      }
    }
  }, [content, onValidationErrors])

  // Handle simple string content (fallback for plain text)
  if (typeof content === 'string') {
    return (
      <span className={cn('whitespace-pre-wrap', className)}>
        {content}
      </span>
    )
  }

  // Handle structured highlighted content
  if (!showHighlighting) {
    return (
      <span className={cn('whitespace-pre-wrap', className)}>
        {content.plainText}
      </span>
    )
  }

  return (
    <span className={cn('whitespace-pre-wrap', className)}>
      {content.segments.map((segment, index) => {
        if (!segment.isVariable) {
          // Regular text segment
          return (
            <span key={index}>
              {segment.text}
            </span>
          )
        }

        // Variable segment with highlighting
        const isEmpty = !segment.text || segment.text.trim() === ''
        const highlightClass = getVariableHighlightClass(isEmpty)

        return (
          <span
            key={index}
            className={cn(
              'inline-block px-1 py-0.5 rounded text-xs font-medium transition-all duration-200',
              highlightClass,
              'hover:shadow-sm cursor-help'
            )}
            title={
              isEmpty
                ? `Empty variable: {${segment.variableName}}`
                : `Variable: {${segment.variableName}} = "${segment.text}"`
            }
          >
            {isEmpty ? `{${segment.variableName}}` : segment.text}
          </span>
        )
      })}
    </span>
  )
}