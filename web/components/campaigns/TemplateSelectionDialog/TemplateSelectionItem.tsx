'use client'

import { useState, useRef, useEffect } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff } from 'lucide-react'
import { MessageTemplate } from '@/components/campaigns/types/campaign.types'
import { SimpleHighlightedText } from '../SimpleHighlightedText'

interface TemplateSelectionItemProps {
  template: MessageTemplate
  isSelected: boolean
  onToggle: () => void
}

export function TemplateSelectionItem({
  template,
  isSelected,
  onToggle
}: TemplateSelectionItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isContentTruncated, setIsContentTruncated] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Check if content is actually truncated by comparing scroll width vs client width
  useEffect(() => {
    const checkTruncation = () => {
      if (contentRef.current && !isExpanded) {
        const element = contentRef.current
        setIsContentTruncated(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)
      }
    }

    checkTruncation()
    // Recheck on window resize in case layout changes
    window.addEventListener('resize', checkTruncation)
    return () => window.removeEventListener('resize', checkTruncation)
  }, [isExpanded, template.content])

  return (
    <div className='border border-muted rounded p-2'>
      <div className='flex items-start space-x-2'>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
        />
        <div className='flex-1 min-w-0'>
          <div className='flex items-center justify-between'>
            <span className='font-medium text-sm truncate pr-2'>{template.name}</span>
            <div className='flex items-center space-x-2 shrink-0'>
              {isContentTruncated && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='p-1 h-6 w-6'
                  onClick={() => setIsExpanded(!isExpanded)}
                  title={isExpanded ? 'Hide full content' : 'Show full content'}
                >
                  {isExpanded ? (
                    <EyeOff className='h-3 w-3' />
                  ) : (
                    <Eye className='h-3 w-3' />
                  )}
                </Button>
              )}
              <Badge variant='secondary' className='text-xs'>
                {template.content.length} chars
              </Badge>
            </div>
          </div>
          <div
            ref={contentRef}
            className={`text-xs text-muted-foreground mt-1 transition-all duration-200 ${
              isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'
            }`}
            style={{ maxHeight: isExpanded ? '200px' : '20px', overflow: isExpanded ? 'auto' : 'hidden' }}
          >
            <SimpleHighlightedText content={template.content} />
          </div>
        </div>
      </div>
    </div>
  )
}