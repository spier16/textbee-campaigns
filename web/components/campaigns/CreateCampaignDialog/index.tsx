'use client'

import { useState, useEffect, useMemo } from 'react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import {
  Trash2,
  MessageSquare,
  Plus,
  Settings,
  Eye,
  FileText,
  Copy,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { ContactSpreadsheet, Contact, contactsApi } from '@/lib/api/contacts'
import { MessageTemplate, campaignsApi, ProcessTemplatePreviewDto, TemplatePreview, HighlightedContent, ValidationError } from '@/lib/api/campaigns'
import {
  CreateCampaignData,
  DateValidationErrors,
  MessageTemplateGroup
} from '@/components/campaigns/types/campaign.types'
import { SendingScheduleCalendar } from './SendingScheduleCalendar'
import { HighlightedText } from '@/components/campaigns/HighlightedText'

// Type alias for consistency with API response
type CampaignMessagePreview = TemplatePreview

// Device interface (from API response) - Using usage plan system
interface Device {
  _id: string
  brand: string
  model: string
  enabled: boolean
  current_tier?: number
  messages_sent_today?: number
  messages_sent_this_hour?: number
  hourly_counter_reset?: Date
  daily_counter_reset?: Date
  last_tier_upgrade?: Date
  plan_type?: number
  usagePlan?: string // Usage plan ID
}

// Usage plan interfaces
interface UsagePlanTier {
  tier: number
  min_wait_seconds: number // in seconds
  messages_per_cycle: number
}

interface UsagePlan {
  _id: string
  name: string
  description?: string
  tiers: UsagePlanTier[]
  isDefault: boolean
  isActive: boolean
}

// Props interface for the CreateCampaignDialog component
interface CreateCampaignDialogProps {
  // Dialog state
  open: boolean
  onOpenChange: (open: boolean) => void

  // Campaign data and handlers
  campaignData: CreateCampaignData
  onCampaignDataChange: (data: CreateCampaignData) => void

  // External data
  contactSpreadsheets?: ContactSpreadsheet[]
  devices?: Device[]
  usagePlans?: UsagePlan[]
  templateGroups?: MessageTemplateGroup[]
  uniqueContactCount: number

  // Date validation
  dateValidationErrors: DateValidationErrors
  onDateValidationChange: (errors: DateValidationErrors) => void

  // Template management
  onManageTemplatesOpen: () => void
  onTemplateSelectionOpen: () => void

  // Callback functions
  onCreateCampaign: () => void
}

export function CreateCampaignDialog({
  open,
  onOpenChange,
  campaignData,
  onCampaignDataChange,
  contactSpreadsheets = [],
  devices = [],
  usagePlans = [],
  templateGroups = [],
  uniqueContactCount,
  dateValidationErrors,
  onDateValidationChange,
  onManageTemplatesOpen,
  onTemplateSelectionOpen,
  onCreateCampaign
}: CreateCampaignDialogProps) {
  const [activeTab, setActiveTab] = useState('details')
  const [messagePreview, setMessagePreview] = useState<CampaignMessagePreview[]>([])
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [showValidationWarningDialog, setShowValidationWarningDialog] = useState(false)

  const { toast } = useToast()

  // Track viewport height for dynamic spacing
  useEffect(() => {
    const updateViewportHeight = () => setViewportHeight(window.innerHeight)
    updateViewportHeight()
    window.addEventListener('resize', updateViewportHeight)
    return () => window.removeEventListener('resize', updateViewportHeight)
  }, [])

  // Calculate dynamic spacing based on viewport height
  const getDynamicSpacing = () => {
    if (viewportHeight === 0) return { isCompact: false, headerSpacing: 'mb-1 sm:mb-2', tabSpacing: 'p-3 sm:p-4' }

    const isSmallViewport = viewportHeight < 700
    const isTinyViewport = viewportHeight < 600

    return {
      isCompact: isSmallViewport,
      isTiny: isTinyViewport,
      headerSpacing: isTinyViewport ? 'mb-0.5' : isSmallViewport ? 'mb-1' : 'mb-1 sm:mb-2',
      tabSpacing: isTinyViewport ? 'p-2' : isSmallViewport ? 'p-3' : 'p-3 sm:p-4',
      titleHeight: isTinyViewport ? 'h-7' : isSmallViewport ? 'h-8' : 'h-8 sm:h-10',
      titleText: isTinyViewport ? 'text-sm' : 'text-base sm:text-xl'
    }
  }

  const spacing = getDynamicSpacing()

  // Memoized timezone options with searchable display format
  const timezoneOptions = useMemo(() => {
    const allTimezones = Intl.supportedValuesOf('timeZone')
    return allTimezones.map(tz => {
      try {
        const parts = tz.split('/')
        const city = parts[parts.length - 1].replace(/_/g, ' ')
        const region = parts.length > 1 ? parts[0].replace(/_/g, ' ') : ''

        // Get GMT offset
        const date = new Date()
        const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000)
        const targetTime = new Date(utcTime + (0)) // Start with UTC

        // Use Intl.DateTimeFormat to get proper offset
        const formatter = new Intl.DateTimeFormat('en', {
          timeZone: tz,
          timeZoneName: 'longOffset'
        })

        let gmtOffset = ''
        try {
          const parts = formatter.formatToParts(new Date())
          const offsetPart = parts.find(part => part.type === 'timeZoneName')
          if (offsetPart && offsetPart.value !== 'GMT') {
            gmtOffset = ` ${offsetPart.value}`
          }
        } catch {
          // Fallback to short timezone name
          const timeString = new Date().toLocaleTimeString('en-US', {
            timeZone: tz,
            timeZoneName: 'short'
          })
          const abbreviation = timeString.split(' ').pop() || ''
          gmtOffset = abbreviation ? ` ${abbreviation}` : ''
        }

        // Format: "City, Region GMT+X" for better type-to-search
        const label = region && region !== city
          ? `${city}, ${region}${gmtOffset}`
          : `${city}${gmtOffset}`

        return {
          value: tz,
          label: label
        }
      } catch (e) {
        // Fallback for invalid timezones
        const city = tz.split('/').pop()?.replace(/_/g, ' ') || tz
        return {
          value: tz,
          label: city
        }
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label)) // Sort by city name
  }, [])

  // Helper functions for usage plan management
  const getCurrentTier = (device: Device): UsagePlanTier | null => {
    if (!device.usagePlan || !usagePlans) return null
    const plan = usagePlans.find(p => p._id === device.usagePlan)
    if (!plan) return null
    return plan.tiers.find(t => t.tier === (device.current_tier || 1)) || plan.tiers[0]
  }

  const formatTimeDelay = (seconds: number): string => {
    if (seconds === 0) return 'No delay'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (remainingSeconds === 0) return `${minutes}m`
    return `${minutes}m ${remainingSeconds}s`
  }

  const getDeviceRateInfo = (device: Device): { hourlyInfo: string; dailyInfo: string } => {
    const currentTier = getCurrentTier(device)
    if (!currentTier) {
      return {
        hourlyInfo: 'No usage plan',
        dailyInfo: 'No usage plan'
      }
    }

    // Convert time delay to hourly rate for display
    const messagesPerHour = currentTier.min_wait_seconds > 0
      ? Math.floor(3600 / currentTier.min_wait_seconds)
      : 0

    return {
      hourlyInfo: `~${messagesPerHour}/hr (${formatTimeDelay(currentTier.min_wait_seconds)} delay)`,
      dailyInfo: `${currentTier.messages_per_cycle}/day`
    }
  }

  // Function to generate message preview data using backend API
  const generateMessagePreview = async () => {
    setPreviewLoading(true)
    try {
      if (campaignData.selectedTemplates.length === 0) {
        setMessagePreview([])
        return
      }

      if (campaignData.selectedContacts.length === 0) {
        setMessagePreview([])
        return
      }

      // Prepare request data for backend API
      const processPreviewData: ProcessTemplatePreviewDto = {
        templateIds: campaignData.selectedTemplates,
        contactSpreadsheetIds: campaignData.selectedContacts,
        excludeDnc: campaignData.excludeDnc,
        includePreviouslyMessaged: campaignData.includePreviouslyMessaged,
        maxPreviewCount: 100, // Limit preview to reasonable number for UI performance
        highlightVariables: true, // Enable variable highlighting for preview
      }

      // Call backend API to process template variables
      const response = await campaignsApi.processTemplatePreview(processPreviewData)

      // Sort previews to show messages with validation errors first
      const sortedPreviews = [...response.previews].sort((a, b) => {
        const aHasErrors = (a.highlightedContent?.validationErrors?.length ?? 0) > 0
        const bHasErrors = (b.highlightedContent?.validationErrors?.length ?? 0) > 0
        if (aHasErrors && !bHasErrors) return -1
        if (!aHasErrors && bHasErrors) return 1
        return 0
      })

      setMessagePreview(sortedPreviews)
      setCurrentPreviewIndex(0)
    } catch (error) {
      console.error('Error generating message preview:', error)
      toast({
        title: 'Preview Error',
        description: 'Failed to generate message preview. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setPreviewLoading(false)
    }
  }

  // Helper function to count messages with validation errors
  const getValidationErrorCount = () => {
    return messagePreview.filter(msg =>
      (msg.highlightedContent?.validationErrors?.length ?? 0) > 0
    ).length
  }

  // Helper function to handle campaign save with validation check
  const handleSaveWithValidation = () => {
    const errorCount = getValidationErrorCount()
    if (errorCount > 0) {
      setShowValidationWarningDialog(true)
    } else {
      onCreateCampaign()
    }
  }

  // Clean up deleted template IDs when template groups change
  useEffect(() => {
    if (templateGroups && campaignData.selectedTemplates.length > 0) {
      // Get all valid template IDs from current template groups
      const validTemplateIds = new Set<string>()
      templateGroups.forEach(group => {
        group.templates.forEach(template => {
          validTemplateIds.add(template._id)
        })
      })

      // Filter out invalid template IDs
      const validSelectedTemplates = campaignData.selectedTemplates.filter(id => validTemplateIds.has(id))

      // Update state if any templates were removed
      if (validSelectedTemplates.length !== campaignData.selectedTemplates.length) {
        onCampaignDataChange({
          ...campaignData,
          selectedTemplates: validSelectedTemplates
        })
      }
    }
  }, [templateGroups])

  // Generate preview when tab becomes active and data is available
  useEffect(() => {
    if (activeTab === 'preview' && open && campaignData.selectedContacts.length > 0 && campaignData.selectedTemplates.length > 0) {
      generateMessagePreview()
    }
  }, [activeTab, open, campaignData.selectedContacts, campaignData.selectedTemplates, campaignData.excludeDnc, campaignData.includePreviouslyMessaged])

  // Date validation function
  const validateDates = (startDate: string, endDate: string) => {
    // Get today's date in the selected timezone
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: campaignData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    })
    const errors = { startDateError: '', endDateError: '' }

    // Don't validate start date if schedule type is 'now' (disabled field)
    if (campaignData.scheduleType !== 'now' && startDate) {
      // Convert startDate to the same timezone for proper comparison
      // Parse the date as if it's in the selected timezone to avoid timezone issues
      const startDateInTimezone = new Date(startDate + 'T00:00:00')
      const todayInTimezone = new Date(today + 'T00:00:00')

      if (startDateInTimezone < todayInTimezone) {
        errors.startDateError = 'Campaign start date cannot be before today'
      }
    }

    // For end date comparison, we can use simple string comparison since both are in YYYY-MM-DD format
    if (startDate && endDate && endDate < startDate) {
      errors.endDateError = 'Campaign end date cannot be before start date'
    }

    onDateValidationChange(errors)
    return errors.startDateError === '' && errors.endDateError === ''
  }

  // Validate dates when dialog opens, schedule type changes, or timezone changes
  useEffect(() => {
    if (open) {
      // Clear validation errors when switching to "now" schedule type since the field is disabled
      if (campaignData.scheduleType === 'now') {
        onDateValidationChange({ startDateError: '', endDateError: '' })
      } else {
        validateDates(campaignData.campaignStartDate, campaignData.campaignEndDate)
      }
    }
  }, [open, campaignData.scheduleType, campaignData.timezone || 'default'])

  // Validation functions for each stage
  const validateDetailsStage = () => {
    const hasContacts = campaignData.selectedContacts.length > 0
    const hasValidContacts = uniqueContactCount > 0
    const hasTemplates = campaignData.selectedTemplates.length > 0
    return hasContacts && hasValidContacts && hasTemplates
  }

  const validateConfigureStage = () => {
    const hasCampaignName = campaignData.name.trim().length > 0
    const hasTemplates = campaignData.selectedTemplates.length > 0
    const hasDevices = campaignData.sendDevices.length > 0
    const hasValidDates = campaignData.campaignStartDate &&
                         campaignData.campaignEndDate &&
                         dateValidationErrors.startDateError === '' &&
                         dateValidationErrors.endDateError === ''
    const hasValidSchedule = campaignData.scheduleType === 'now' ||
      campaignData.scheduleType === 'later' ||
      (campaignData.scheduleType === 'windows' &&
       campaignData.sendingWindows.length > 0) ||
      (campaignData.scheduleType === 'weekday' &&
       Object.entries(campaignData.weekdayWindows).some(([day, dayWindows]) =>
         campaignData.weekdayEnabled[day as keyof typeof campaignData.weekdayEnabled] && dayWindows.length > 0))

    return hasCampaignName && hasTemplates && hasDevices && hasValidDates && hasValidSchedule
  }

  const canNavigateToTab = (targetTab: string) => {
    if (targetTab === 'details') return true
    if (targetTab === 'configure') return validateDetailsStage()
    if (targetTab === 'preview') return validateDetailsStage() && validateConfigureStage()
    return false
  }

  const handleClose = () => {
    onOpenChange(false)
    setActiveTab('details')
    setMessagePreview([])
    setCurrentPreviewIndex(0)
    setValidationErrors([])
    onDateValidationChange({ startDateError: '', endDateError: '' })
  }

  const handleTabChange = (value: string) => {
    if (canNavigateToTab(value)) {
      setActiveTab(value)
    } else {
      if (value === 'configure' && !validateDetailsStage()) {
        const hasContacts = campaignData.selectedContacts.length > 0
        const hasValidContacts = uniqueContactCount > 0
        const hasTemplates = campaignData.selectedTemplates.length > 0

        let description = "Please complete the following: "
        const missing = []
        if (!hasContacts) missing.push("select contacts")
        else if (!hasValidContacts) missing.push("adjust filters (no valid contacts after filtering)")
        if (!hasTemplates) missing.push("select message templates")
        description += missing.join(" and ")

        toast({
          title: "Complete required fields",
          description,
          variant: "destructive"
        })
      } else if (value === 'preview' && !validateConfigureStage()) {
        toast({
          title: "Complete SMS configuration",
          description: "Please enter campaign name, select template groups, devices, and schedule before previewing.",
          variant: "destructive"
        })
      }
    }
  }

  const handlePrevious = () => {
    const tabs = ['details', 'configure', 'preview']
    const currentIndex = tabs.indexOf(activeTab)
    if (currentIndex > 0) {
      setActiveTab(tabs[currentIndex - 1])
    }
  }

  const handleNext = () => {
    const tabs = ['details', 'configure', 'preview']
    const currentIndex = tabs.indexOf(activeTab)
    if (currentIndex < tabs.length - 1) {
      const nextTab = tabs[currentIndex + 1]
      if (canNavigateToTab(nextTab)) {
        setActiveTab(nextTab)
      } else {
        if (nextTab === 'configure' && !validateDetailsStage()) {
          const hasContacts = campaignData.selectedContacts.length > 0
          const hasValidContacts = uniqueContactCount > 0
          const hasTemplates = campaignData.selectedTemplates.length > 0

          let description = "Please complete the following: "
          const missing = []
          if (!hasContacts) missing.push("select contacts")
          else if (!hasValidContacts) missing.push("adjust filters (no valid contacts after filtering)")
          if (!hasTemplates) missing.push("select message templates")
          description += missing.join(" and ")

          toast({
            title: "Complete required fields",
            description,
            variant: "destructive"
          })
        } else if (nextTab === 'preview' && !validateConfigureStage()) {
          toast({
            title: "Complete SMS configuration",
            description: "Please enter campaign name, select template groups, devices, and schedule before previewing.",
            variant: "destructive"
          })
        }
      }
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='w-[90vw] max-w-6xl h-[90vh] overflow-hidden flex flex-col p-4'>
        <DialogHeader className='flex-shrink-0 border-b p-2 pb-1'>
          <DialogTitle>Create New Campaign</DialogTitle>
          <DialogDescription>
            Set up a new SMS campaign with contacts, message templates, and sending schedule.
          </DialogDescription>
        </DialogHeader>
        <div className='flex-1 overflow-hidden min-h-0'>
          <Tabs value={activeTab} onValueChange={handleTabChange} className='h-full flex flex-col'>
            <TabsList className='h-[50px] w-full grid grid-cols-3 flex-shrink-0'>
              <TabsTrigger value='details' className='flex items-center justify-center gap-2 h-full'>
                <FileText className='h-4 w-4' />
                Details
              </TabsTrigger>
              <TabsTrigger
                value='configure'
                disabled={!canNavigateToTab('configure')}
                className='flex items-center justify-center gap-2 h-full disabled:opacity-50 disabled:cursor-not-allowed'
              >
                <Settings className='h-4 w-4' />
                Configure SMS
              </TabsTrigger>
              <TabsTrigger
                value='preview'
                disabled={!canNavigateToTab('preview')}
                className='flex items-center justify-center gap-2 h-full disabled:opacity-50 disabled:cursor-not-allowed'
              >
                <Eye className='h-4 w-4' />
                Preview
              </TabsTrigger>
            </TabsList>

            <TabsContent value='details' className='flex-1 overflow-y-auto p-4 min-h-0'>
              <div className='space-y-6 max-w-[500px]'>
                <div className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <Label className='text-sm font-medium'>
                      Message Templates<span className='text-red-500'>*</span>
                    </Label>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={onManageTemplatesOpen}
                    >
                      Manage templates
                    </Button>
                  </div>
                  <Button
                    variant='outline'
                    className='w-full justify-start h-10'
                    onClick={onTemplateSelectionOpen}
                  >
                    <MessageSquare className='mr-2 h-4 w-4' />
                    {campaignData.selectedTemplates.length > 0
                      ? `${campaignData.selectedTemplates.length} template(s) selected`
                      : 'Select message templates'}
                  </Button>
                </div>

                <div className='space-y-2'>
                  <Label className='text-sm font-medium'>
                    Selected Contacts<span className='text-red-500'>*</span>
                  </Label>
                  <Select>
                    <SelectTrigger className='w-full'>
                      <SelectValue
                        placeholder={campaignData.selectedContacts.length > 0
                          ? `${campaignData.selectedContacts.length} group(s) selected (${uniqueContactCount.toLocaleString()} unique contacts)`
                          : 'Select contact groups'}
                      />
                    </SelectTrigger>
                    <SelectContent className='max-h-60 overflow-y-auto'>
                      {contactSpreadsheets.length === 0 ? (
                        <div className='px-2 py-4 text-center text-sm text-muted-foreground'>
                          No processed contact spreadsheets available.
                          <br />
                          Process spreadsheets in the Contacts page first.
                        </div>
                      ) : (
                        contactSpreadsheets.map(contact => (
                          <div key={contact.id} className='flex items-center space-x-2 px-2 py-2 cursor-pointer hover:bg-muted/50'
                               onClick={(e) => {
                                 e.preventDefault()
                                 const isSelected = campaignData.selectedContacts.includes(contact.id)
                                 if (isSelected) {
                                   onCampaignDataChange({
                                     ...campaignData,
                                     selectedContacts: campaignData.selectedContacts.filter(id => id !== contact.id)
                                   })
                                 } else {
                                   onCampaignDataChange({
                                     ...campaignData,
                                     selectedContacts: [...campaignData.selectedContacts, contact.id]
                                   })
                                 }
                               }}>
                            <Checkbox
                              checked={campaignData.selectedContacts.includes(contact.id)}
                              onChange={() => {}}
                            />
                            <div className='text-sm'>
                              <div className='font-medium'>{contact.originalFileName}</div>
                              <div className='text-xs text-muted-foreground'>
                                {(contact.validContactsCount || contact.contactCount).toLocaleString()} valid contacts • Uploaded {new Date(contact.uploadDate).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-4'>
                  <div className='flex items-center justify-between'>
                    <Label htmlFor='excludeDnc' className='text-sm font-medium'>
                      Exclude DNC
                    </Label>
                    <Switch
                      id='excludeDnc'
                      checked={campaignData.excludeDnc}
                      onCheckedChange={(checked) => {
                        onCampaignDataChange({ ...campaignData, excludeDnc: checked })
                      }}
                    />
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    Exclude contacts marked as Do Not Call from the campaign
                  </div>
                </div>

                <div className='space-y-4'>
                  <div className='flex items-center justify-between'>
                    <Label htmlFor='includePreviouslyMessaged' className='text-sm font-medium'>
                      Send to Previously Messaged Contacts
                    </Label>
                    <Switch
                      id='includePreviouslyMessaged'
                      checked={campaignData.includePreviouslyMessaged}
                      onCheckedChange={(checked) => {
                        onCampaignDataChange({ ...campaignData, includePreviouslyMessaged: checked })
                      }}
                    />
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    Include contacts who have been messaged before in previous campaigns
                  </div>
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='description' className='text-sm font-medium'>
                    Description
                  </Label>
                  <Textarea
                    id='description'
                    value={campaignData.description}
                    onChange={(e) => {
                      onCampaignDataChange({ ...campaignData, description: e.target.value })
                    }}
                    placeholder='Enter campaign description (optional)'
                    rows={4}
                    className='w-full resize-none'
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value='configure' className='flex-1 overflow-hidden p-4 min-h-0'>
              <div className='grid grid-cols-2 gap-6 h-full'>
                {/* Left Column - Form Controls */}
                <div className='space-y-4 overflow-y-auto max-h-full pr-4'>
                <div className='space-y-2'>
                  <Label htmlFor='name' className='text-sm font-medium'>
                    Campaign Name<span className='text-red-500'>*</span>
                  </Label>
                  <Input
                    id='name'
                    value={campaignData.name}
                    onChange={(e) => {
                      onCampaignDataChange({ ...campaignData, name: e.target.value })
                    }}
                    placeholder='Enter campaign name'
                    className='w-full'
                  />
                </div>

                <div className='space-y-2'>
                  <Label className='text-sm font-medium'>
                    Send Devices<span className='text-red-500'>*</span>
                  </Label>
                  <div className='bg-muted/50 border rounded p-3 space-y-3 max-h-60 overflow-y-auto'>
                    {/* Select/Unselect All Toggle */}
                    <div className='flex items-center justify-between border-b border-border pb-2'>
                      <div className='flex items-center space-x-2'>
                        <Checkbox
                          checked={devices.filter(d => d.enabled).length > 0 &&
                                  devices.filter(d => d.enabled).every(d => campaignData.sendDevices.includes(d._id))}
                          onCheckedChange={(checked) => {
                            const allEnabledDeviceIds = devices.filter(d => d.enabled).map(d => d._id)
                            if (checked) {
                              onCampaignDataChange({ ...campaignData, sendDevices: allEnabledDeviceIds })
                            } else {
                              onCampaignDataChange({ ...campaignData, sendDevices: [] })
                            }
                          }}
                        />
                        <span className='text-sm font-medium'>Select/Unselect all enabled devices</span>
                      </div>
                    </div>

                    {/* Device List */}
                    {devices.length === 0 ? (
                      <div className='text-center text-sm text-muted-foreground py-4'>
                        No devices registered.
                        <br />
                        Register devices in the Dashboard first.
                      </div>
                    ) : (
                      <div className='space-y-2'>
                        {devices.map(device => {
                          const rateInfo = getDeviceRateInfo(device)
                          const currentTier = getCurrentTier(device)

                          return (
                            <div key={device._id} className='flex items-center justify-between p-2 rounded border bg-background'>
                              <div className='flex items-center space-x-2'>
                                <Checkbox
                                  checked={campaignData.sendDevices.includes(device._id)}
                                  disabled={!device.enabled}
                                  onCheckedChange={(checked) => {
                                    if (!device.enabled) return
                                    if (checked) {
                                      onCampaignDataChange({
                                        ...campaignData,
                                        sendDevices: [...campaignData.sendDevices, device._id]
                                      })
                                    } else {
                                      onCampaignDataChange({
                                        ...campaignData,
                                        sendDevices: campaignData.sendDevices.filter(id => id !== device._id)
                                      })
                                    }
                                  }}
                                  className={!device.enabled ? 'opacity-50' : ''}
                                />
                                <div className={`text-sm ${!device.enabled ? 'opacity-50' : ''}`}>
                                  <div className='flex items-center gap-2'>
                                    <span className='font-medium'>{device.brand} {device.model}</span>
                                    <Badge variant={device.enabled ? 'default' : 'secondary'} className='text-xs'>
                                      {device.enabled ? 'Enabled' : 'Disabled'}
                                    </Badge>
                                    {currentTier && (
                                      <Badge variant='outline' className='text-xs'>
                                        Tier {device.current_tier || 1}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className='text-xs text-muted-foreground mt-1'>
                                    <code className='bg-muted px-1 py-0.5 rounded text-xs'>
                                      {device._id}
                                    </code>
                                  </div>
                                </div>
                              </div>
                              <div className={`text-xs text-muted-foreground text-right ${!device.enabled ? 'opacity-50' : ''}`}>
                                <div>{rateInfo.hourlyInfo}</div>
                                <div>{rateInfo.dailyInfo}</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className='space-y-2'>
                  <Label className='text-sm font-medium'>Schedule Send</Label>
                  <Select
                    value={campaignData.scheduleType}
                    onValueChange={(value) => {
                      console.log(`DEBUG: Changing schedule type from ${campaignData.scheduleType} to ${value}`)
                      console.log(`DEBUG: Current weekdayWindows:`, campaignData.weekdayWindows)
                      onCampaignDataChange({ ...campaignData, scheduleType: value as any })
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select scheduling option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="now">Start sending now</SelectItem>
                      <SelectItem value="later">Schedule start for later</SelectItem>
                      <SelectItem value="weekday">Define valid sending windows by weekday</SelectItem>
                      <SelectItem value="windows">Define valid sending windows by slot</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Campaign Start and End Date fields */}
                  <div className='space-y-2'>
                    <div className='flex gap-4'>
                      <div className='space-y-1 flex-1'>
                        <Label className='text-xs text-muted-foreground'>
                          Campaign Start Date<span className='text-red-500'>*</span>
                        </Label>
                        <Input
                          type='date'
                          value={campaignData.campaignStartDate}
                          disabled={campaignData.scheduleType === 'now'}
                          onChange={(e) => {
                            const newStartDate = e.target.value
                            onCampaignDataChange({
                              ...campaignData,
                              campaignStartDate: newStartDate
                            })
                            validateDates(newStartDate, campaignData.campaignEndDate)
                          }}
                          className='w-full'
                        />
                        {dateValidationErrors.startDateError && (
                          <p className='text-xs text-red-600'>{dateValidationErrors.startDateError}</p>
                        )}
                      </div>
                      <div className='space-y-1 flex-1'>
                        <Label className='text-xs text-muted-foreground'>
                          Campaign End Date<span className='text-red-500'>*</span>
                        </Label>
                        <Input
                          type='date'
                          value={campaignData.campaignEndDate}
                          onChange={(e) => {
                            const newEndDate = e.target.value
                            onCampaignDataChange({
                              ...campaignData,
                              campaignEndDate: newEndDate
                            })
                            validateDates(campaignData.campaignStartDate, newEndDate)
                          }}
                          className='w-full'
                        />
                        {dateValidationErrors.endDateError && (
                          <p className='text-xs text-red-600'>{dateValidationErrors.endDateError}</p>
                        )}
                      </div>
                    </div>
                    <div className='space-y-1'>
                      <Label className='text-xs text-muted-foreground'>
                        Timezone
                      </Label>
                      <Select
                        value={campaignData.timezone}
                        onValueChange={(value) => {
                          onCampaignDataChange({ ...campaignData, timezone: value })
                          // Re-validate dates when timezone changes
                          validateDates(campaignData.campaignStartDate, campaignData.campaignEndDate)
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select timezone..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          {timezoneOptions.map(tz => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                    {campaignData.scheduleType === 'windows' && (
                      <div className='ml-6 space-y-4 border-l-2 border-muted pl-4'>
                        <div className='text-xs text-muted-foreground bg-blue-50 p-2 rounded border border-blue-200'>
                          <strong>Note:</strong> Define specific days and time windows when messages can be sent.
                          Messages will only be sent during these windows.
                        </div>

                        <div className='flex items-center justify-between'>
                          <Label className='text-xs text-muted-foreground font-medium'>
                            Sending Windows<span className='text-red-500'>*</span>
                          </Label>
                          <Button
                            size='sm'
                            variant='outline'
                            className='gap-1 text-xs h-7'
                            onClick={() => {
                              onCampaignDataChange({
                                ...campaignData,
                                sendingWindows: [...campaignData.sendingWindows, { startDate: '', startTime: '', endDate: '', endTime: '' }]
                              })
                              // Auto-scroll to bottom after adding new window
                              setTimeout(() => {
                                const leftColumn = document.querySelector('[role="dialog"] .space-y-4.overflow-y-auto.max-h-full.pr-4')
                                if (leftColumn) {
                                  leftColumn.scrollTo({
                                    top: leftColumn.scrollHeight,
                                    behavior: 'smooth'
                                  })
                                }
                              }, 100)
                            }}
                          >
                            <Plus className='h-3 w-3' />
                            Add window
                          </Button>
                        </div>

                        {campaignData.sendingWindows.length === 0 ? (
                          <div className='text-xs text-muted-foreground text-center py-4 bg-muted/50 rounded border-dashed border'>
                            No sending windows defined. Click "Add window" to create one.
                          </div>
                        ) : (
                          <div className='space-y-3'>
                            {/* Headers */}
                            <div className='flex items-center gap-2 px-2'>
                              <div className='flex gap-2 flex-1'>
                                <div className='w-32'>
                                  <Label className='text-xs text-muted-foreground font-medium'>Start date</Label>
                                </div>
                                <div className='w-24'>
                                  <Label className='text-xs text-muted-foreground font-medium'>Start time</Label>
                                </div>
                                <div className='w-32'>
                                  <Label className='text-xs text-muted-foreground font-medium'>End date</Label>
                                </div>
                                <div className='w-24'>
                                  <Label className='text-xs text-muted-foreground font-medium'>End time</Label>
                                </div>
                              </div>
                              <div className='w-6'></div> {/* Spacer for remove button */}
                            </div>

                            {/* Window Items */}
                            {campaignData.sendingWindows.map((window, index) => (
                              <div key={index} className='flex items-center gap-2 p-2 bg-muted/30 rounded border'>
                                <div className='flex gap-2 flex-1'>
                                  <Input
                                    type='date'
                                    value={window.startDate}
                                    onChange={(e) => {
                                      const newWindows = [...campaignData.sendingWindows]
                                      newWindows[index].startDate = e.target.value
                                      // Auto-update end date if it's empty
                                      if (!newWindows[index].endDate) {
                                        newWindows[index].endDate = e.target.value
                                      }
                                      onCampaignDataChange({ ...campaignData, sendingWindows: newWindows })
                                    }}
                                    className='w-32 text-xs h-8'
                                  />
                                  <Input
                                    type='time'
                                    value={window.startTime}
                                    onChange={(e) => {
                                      const newWindows = [...campaignData.sendingWindows]
                                      newWindows[index].startTime = e.target.value
                                      onCampaignDataChange({ ...campaignData, sendingWindows: newWindows })
                                    }}
                                    className='w-24 text-xs h-8'
                                  />
                                  <Input
                                    type='date'
                                    value={window.endDate}
                                    onChange={(e) => {
                                      const newWindows = [...campaignData.sendingWindows]
                                      newWindows[index].endDate = e.target.value
                                      onCampaignDataChange({ ...campaignData, sendingWindows: newWindows })
                                    }}
                                    className='w-32 text-xs h-8'
                                  />
                                  <Input
                                    type='time'
                                    value={window.endTime}
                                    onChange={(e) => {
                                      const newWindows = [...campaignData.sendingWindows]
                                      newWindows[index].endTime = e.target.value
                                      onCampaignDataChange({ ...campaignData, sendingWindows: newWindows })
                                    }}
                                    className='w-24 text-xs h-8'
                                  />
                                </div>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  className='p-1 h-6 w-6 text-muted-foreground hover:text-destructive'
                                  onClick={() => {
                                    const newWindows = campaignData.sendingWindows.filter((_, i) => i !== index)
                                    onCampaignDataChange({ ...campaignData, sendingWindows: newWindows })
                                  }}
                                >
                                  <X className='h-3 w-3' />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {campaignData.scheduleType === 'weekday' && (
                      <div className='ml-6 space-y-4 border-l-2 border-muted pl-4'>
                        <div className='text-xs text-muted-foreground bg-blue-50 p-2 rounded border border-blue-200'>
                          <strong>Note:</strong> Define time windows for each day of the week when messages can be sent.
                          Messages will only be sent during these time windows on the respective days.
                        </div>

                        {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
                          <div key={day} className='space-y-2'>
                            <div className='flex items-center justify-between'>
                              <div className='flex items-center gap-2'>
                                <Checkbox
                                  checked={campaignData.weekdayEnabled[day as keyof typeof campaignData.weekdayEnabled]}
                                  onCheckedChange={(checked) => {
                                    onCampaignDataChange({
                                      ...campaignData,
                                      weekdayEnabled: {
                                        ...campaignData.weekdayEnabled,
                                        [day]: checked as boolean
                                      }
                                    })
                                  }}
                                  className='h-4 w-4'
                                />
                                <Label className={`text-sm font-medium capitalize cursor-pointer ${
                                  campaignData.weekdayEnabled[day as keyof typeof campaignData.weekdayEnabled]
                                    ? 'text-foreground'
                                    : 'text-muted-foreground'
                                }`}>
                                  {day}
                                </Label>
                              </div>
                              <div className='flex gap-2'>
                                {campaignData.weekdayEnabled[day as keyof typeof campaignData.weekdayEnabled] && (
                                  <>
                                    {campaignData.weekdayWindows[day as keyof typeof campaignData.weekdayWindows].length > 0 && (
                                      <Button
                                        size='sm'
                                        variant='outline'
                                        className='gap-1 text-xs h-7 text-destructive hover:text-destructive hover:bg-destructive/10'
                                        onClick={() => {
                                          onCampaignDataChange({
                                            ...campaignData,
                                            weekdayWindows: {
                                              ...campaignData.weekdayWindows,
                                              [day]: []
                                            }
                                          })
                                        }}
                                        title={`Clear all windows for ${day}`}
                                      >
                                        <Trash2 className='h-3 w-3' />
                                        Clear
                                      </Button>
                                    )}
                                    <Button
                                      size='sm'
                                      variant='outline'
                                      className='gap-1 text-xs h-7'
                                      onClick={() => {
                                        console.log(`DEBUG: Adding new window for ${day}`)
                                        console.log(`DEBUG: Current windows for ${day}:`, campaignData.weekdayWindows[day as keyof typeof campaignData.weekdayWindows])
                                        const newWindowsForDay = [...campaignData.weekdayWindows[day as keyof typeof campaignData.weekdayWindows], { startTime: '', endTime: '' }]
                                        console.log(`DEBUG: New windows for ${day}:`, newWindowsForDay)
                                        onCampaignDataChange({
                                          ...campaignData,
                                          weekdayWindows: {
                                            ...campaignData.weekdayWindows,
                                            [day]: newWindowsForDay
                                          }
                                        })
                                      }}
                                    >
                                      <Plus className='h-3 w-3' />
                                      Add window
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>

                            {campaignData.weekdayEnabled[day as keyof typeof campaignData.weekdayEnabled] && (
                              campaignData.weekdayWindows[day as keyof typeof campaignData.weekdayWindows].length === 0 ? (
                                <div className='text-xs text-muted-foreground text-center py-2 bg-muted/30 rounded border-dashed border ml-4'>
                                  No windows for {day}
                                </div>
                              ) : (
                              <div className='ml-4 space-y-2'>
                                {campaignData.weekdayWindows[day as keyof typeof campaignData.weekdayWindows].map((window, index) => (
                                  <div key={index} className='flex items-center gap-2 p-2 bg-muted/20 rounded border'>
                                    <div className='flex gap-2 flex-1'>
                                      <div className='flex flex-col'>
                                        <Label className='text-xs text-muted-foreground mb-1'>Start time</Label>
                                        <Input
                                          type='time'
                                          value={window.startTime}
                                          onChange={(e) => {
                                            console.log(`DEBUG: Changing ${day} window ${index} start time to:`, e.target.value)
                                            const newWindows = { ...campaignData.weekdayWindows }
                                            newWindows[day as keyof typeof newWindows][index].startTime = e.target.value
                                            console.log(`DEBUG: New weekdayWindows for ${day}:`, newWindows[day as keyof typeof newWindows])
                                            onCampaignDataChange({ ...campaignData, weekdayWindows: newWindows })
                                          }}
                                          className='w-24 text-xs h-8'
                                        />
                                      </div>
                                      <div className='flex flex-col'>
                                        <Label className='text-xs text-muted-foreground mb-1'>End time</Label>
                                        <Input
                                          type='time'
                                          value={window.endTime}
                                          onChange={(e) => {
                                            console.log(`DEBUG: Changing ${day} window ${index} end time to:`, e.target.value)
                                            const newWindows = { ...campaignData.weekdayWindows }
                                            newWindows[day as keyof typeof newWindows][index].endTime = e.target.value
                                            console.log(`DEBUG: New weekdayWindows for ${day}:`, newWindows[day as keyof typeof newWindows])
                                            onCampaignDataChange({ ...campaignData, weekdayWindows: newWindows })
                                          }}
                                          className='w-24 text-xs h-8'
                                        />
                                      </div>
                                    </div>
                                    <div className='flex gap-1'>
                                      {window.startTime && window.endTime && (
                                        <Button
                                          size='sm'
                                          variant='ghost'
                                          className='p-1 h-6 w-6 text-muted-foreground hover:text-foreground'
                                          onClick={() => {
                                            // Propagate this specific window to all other enabled days
                                            const newWindows = { ...campaignData.weekdayWindows }
                                            const windowToCopy = { startTime: window.startTime, endTime: window.endTime }

                                            // Add the window to all enabled days only
                                            Object.keys(newWindows).forEach(dayKey => {
                                              if (dayKey !== day && campaignData.weekdayEnabled[dayKey as keyof typeof campaignData.weekdayEnabled]) {
                                                newWindows[dayKey as keyof typeof newWindows] = [
                                                  ...newWindows[dayKey as keyof typeof newWindows],
                                                  windowToCopy
                                                ]
                                              }
                                            })

                                            onCampaignDataChange({ ...campaignData, weekdayWindows: newWindows })
                                          }}
                                          title={`Copy this window (${window.startTime} - ${window.endTime}) to all other enabled days`}
                                        >
                                          <Copy className='h-3 w-3' />
                                        </Button>
                                      )}
                                      <Button
                                        size='sm'
                                        variant='ghost'
                                        className='p-1 h-6 w-6 text-muted-foreground hover:text-destructive'
                                        onClick={() => {
                                          const newWindows = { ...campaignData.weekdayWindows }
                                          newWindows[day as keyof typeof newWindows] = newWindows[day as keyof typeof newWindows].filter((_, i) => i !== index)
                                          onCampaignDataChange({ ...campaignData, weekdayWindows: newWindows })
                                        }}
                                        title={`Remove this window`}
                                      >
                                        <X className='h-3 w-3' />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>

                {/* Right Column - Sending Schedule Calendar */}
                <div className='flex flex-col h-full overflow-hidden min-h-0'>
                  <Label className='text-sm font-medium mb-2 flex-shrink-0'>Sending Schedule</Label>
                  <div className='flex-1 border rounded-lg p-4 bg-white overflow-hidden min-h-0'>
                    <SendingScheduleCalendar campaignData={campaignData} />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value='preview' className={`flex-1 overflow-hidden ${spacing.tabSpacing} min-h-0`}>
              <div className='h-full flex flex-col'>
                {/* Campaign Name Header - Dynamic Spacing */}
                <div className={`flex-shrink-0 ${spacing.headerSpacing} ${spacing.titleHeight} flex items-center justify-center px-2`}>
                  <h3 className={`${spacing.titleText} font-semibold text-center line-clamp-2`}>{campaignData.name || 'Untitled Campaign'}</h3>
                </div>

                {/* Main Content Area - Fills remaining space with guaranteed clearance */}
                <div className='flex-1 flex flex-col min-h-0' style={{
                  minHeight: spacing.isTiny ? '200px' : spacing.isCompact ? '250px' : '300px'
                }}>
                  {previewLoading ? (
                    <div className='flex-1 flex flex-col items-center justify-center space-y-4'>
                      <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary'></div>
                      <p className='text-sm text-muted-foreground'>Generating message preview...</p>
                    </div>
                  ) : messagePreview.length === 0 ? (
                    <div className='flex-1 flex items-center justify-center'>
                      <div className='text-center space-y-2'>
                        <p className='text-muted-foreground'>No messages to preview</p>
                        <p className='text-sm text-muted-foreground'>Select contacts and templates to see message preview</p>
                      </div>
                    </div>
                  ) : (
                    <div className='flex-1 flex flex-col items-center px-2 sm:px-0 min-h-0'>
                      {/* Message Card - Responsive sizing with overlap prevention */}
                      <div className={`w-full max-w-lg flex-1 flex flex-col min-h-0 ${spacing.isTiny ? 'mb-2' : 'mb-3'}`}>
                        <div className={`bg-card border border-border rounded-lg ${spacing.isTiny ? 'p-1' : 'p-2 sm:p-3'} shadow-sm flex-1 flex flex-col`} style={{
                          minHeight: spacing.isTiny ? '120px' : spacing.isCompact ? '160px' : '200px',
                          maxHeight: `calc(100vh - ${spacing.isTiny ? '320px' : spacing.isCompact ? '360px' : '400px'})`
                        }}>
                          {(() => {
                            const currentMessage = messagePreview[currentPreviewIndex]
                            const contact = currentMessage.contact
                            const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim()

                            return (
                              <div className='h-full flex flex-col min-h-0'>
                                {/* Recipient Info - Responsive Height */}
                                <div className={`border-b ${spacing.isTiny ? 'pb-1' : 'pb-2 sm:pb-3'} flex-shrink-0 ${spacing.isTiny ? 'h-10' : 'h-14 sm:h-16'} flex flex-col justify-center`}>
                                  <h4 className={`font-semibold ${spacing.isTiny ? 'text-sm' : 'text-base sm:text-lg'} truncate`}>
                                    {fullName || 'Unknown Contact'}
                                  </h4>
                                  <p className='text-muted-foreground text-xs sm:text-sm truncate'>{contact.phone}</p>
                                </div>

                                {/* Header Section - Responsive Height */}
                                <div className={`flex items-center justify-between flex-shrink-0 ${spacing.isTiny ? 'h-6' : 'h-8 sm:h-10'} ${spacing.isTiny ? 'pt-0.5' : 'pt-1 sm:pt-2'}`}>
                                  <Label className='text-xs font-medium text-muted-foreground'>Message Preview</Label>
                                  <Badge variant='outline' className={`text-xs truncate ${spacing.isTiny ? 'max-w-[100px]' : 'max-w-[140px] sm:max-w-[180px]'}`} title={`Template ${currentMessage.templateIndex + 1}: ${currentMessage.template.name}`}>
                                    Template {currentMessage.templateIndex + 1}: {currentMessage.template.name}
                                  </Badge>
                                </div>

                                {/* Message Content - Fills remaining card space */}
                                <div className={`bg-muted/50 ${spacing.isTiny ? 'p-1' : 'p-2 sm:p-3'} rounded-lg border flex-1 overflow-y-auto mt-1 min-h-0`}>
                                  <HighlightedText
                                    content={currentMessage.highlightedContent || currentMessage.processedContent}
                                    className='text-xs sm:text-sm leading-relaxed break-words'
                                    showHighlighting={!!currentMessage.highlightedContent}
                                    onValidationErrors={setValidationErrors}
                                  />
                                </div>

                                {/* Validation Errors Display */}
                                {validationErrors.length > 0 && (
                                  <div className={`mt-2 p-2 bg-red-50 border border-red-200 rounded-lg ${spacing.isTiny ? 'text-xs' : 'text-sm'}`}>
                                    <div className='flex items-center gap-1 mb-1'>
                                      <X className='h-4 w-4 text-red-500 flex-shrink-0' />
                                      <span className='font-medium text-red-800'>Template Validation Errors</span>
                                    </div>
                                    <ul className='space-y-1 text-red-700'>
                                      {validationErrors.map((error, index) => (
                                        <li key={index} className='flex items-start gap-1'>
                                          <span className='text-red-500 font-bold text-xs mt-0.5'>•</span>
                                          <span>{error.message}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      </div>

                      {/* Navigation Controls - Dynamic Spacing */}
                      <div className='w-full max-w-lg flex-shrink-0 -mb-2'>
                        <div className={`flex items-center justify-between ${spacing.isTiny ? 'mb-0.5' : 'mb-1'} ${spacing.isTiny ? 'h-6' : 'h-8'}`}>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() => setCurrentPreviewIndex(Math.max(0, currentPreviewIndex - 1))}
                            disabled={currentPreviewIndex === 0}
                            className={`gap-1 text-xs px-2 ${spacing.isTiny ? 'h-6' : 'h-7 sm:h-8'}`}
                          >
                            <ChevronLeft className='h-3 w-3' />
                            <span className={spacing.isTiny ? 'sr-only' : 'hidden xs:inline'}>Previous</span>
                            <span className={spacing.isTiny ? 'inline' : 'xs:hidden'}>Prev</span>
                          </Button>

                          <span className='text-xs text-muted-foreground px-1 sm:px-2'>
                            {currentPreviewIndex + 1} of {messagePreview.length}
                          </span>

                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() => setCurrentPreviewIndex(Math.min(messagePreview.length - 1, currentPreviewIndex + 1))}
                            disabled={currentPreviewIndex === messagePreview.length - 1}
                            className={`gap-1 text-xs px-2 ${spacing.isTiny ? 'h-6' : 'h-7 sm:h-8'}`}
                          >
                            <span className={spacing.isTiny ? 'inline' : 'hidden xs:inline'}>Next</span>
                            <span className={spacing.isTiny ? 'sr-only' : 'xs:hidden'}>Next</span>
                            <ChevronRight className='h-3 w-3' />
                          </Button>
                        </div>

                        {/* Preview Info - Minimal spacing on tiny screens */}
                        <div className='text-center text-xs text-muted-foreground mb-0'>
                          Showing preview of all {messagePreview.length.toLocaleString()} unique messages
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
        </Tabs>
        </div>
        <DialogFooter className='flex-shrink-0 border-t flex justify-between items-center min-h-[60px] py-2 px-4'>
          <div className='flex gap-2'>
            {activeTab !== 'details' && (
              <Button
                variant='outline'
                onClick={handlePrevious}
              >
                Previous
              </Button>
            )}
            {activeTab !== 'preview' && (
              <Button
                variant='outline'
                disabled={(() => {
                  const tabs = ['details', 'configure', 'preview']
                  const currentIndex = tabs.indexOf(activeTab)
                  if (currentIndex < tabs.length - 1) {
                    const nextTab = tabs[currentIndex + 1]
                    return !canNavigateToTab(nextTab)
                  }
                  return false
                })()}
                onClick={handleNext}
              >
                Next
              </Button>
            )}
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              onClick={handleClose}
            >
              Cancel
            </Button>
            {activeTab === 'preview' && (
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  onClick={handleSaveWithValidation}
                  disabled={!campaignData.name.trim() || campaignData.selectedContacts.length === 0}
                >
                  Save Campaign as Draft
                </Button>
                <Button
                  onClick={() => {
                    // Check for validation errors before launching
                    const errorCount = getValidationErrorCount()
                    if (errorCount > 0) {
                      setShowValidationWarningDialog(true)
                    } else {
                      // TODO: Launch campaign functionality will be added later
                      toast({
                        title: 'Launch Campaign',
                        description: 'Campaign launch functionality will be available soon.',
                        variant: 'default'
                      })
                    }
                  }}
                  disabled={true} // Disabled as requested
                  className='opacity-50 cursor-not-allowed'
                >
                  Launch Campaign
                </Button>
              </div>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Validation Warning Dialog */}
    <Dialog open={showValidationWarningDialog} onOpenChange={setShowValidationWarningDialog}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Template Validation Errors Detected</DialogTitle>
          <DialogDescription>
            {getValidationErrorCount()} out of {messagePreview.length} message{messagePreview.length !== 1 ? 's' : ''} {getValidationErrorCount() !== 1 ? 'have' : 'has'} template validation errors.
            These messages will be sent with blank fields where variables cannot be substituted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className='flex-col sm:flex-row gap-2'>
          <Button
            variant='outline'
            onClick={() => setShowValidationWarningDialog(false)}
            className='w-full sm:w-auto'
          >
            Go Back
          </Button>
          <Button
            onClick={() => {
              setShowValidationWarningDialog(false)
              onCreateCampaign()
            }}
            className='w-full sm:w-auto'
          >
            Continue Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}