'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Upload,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Users,
  Megaphone,
  ChevronUp,
  ChevronDown,
  Edit,
  Save,
  X,
  Plus,
  Check,
  Calendar,
  Settings,
  FileText,
  Copy,
  Play,
  Pause,
  Archive,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { contactsApi, ContactSpreadsheet } from '@/lib/api/contacts'
import { campaignsApi, MessageTemplateGroup, MessageTemplate, ReorderTemplateGroupsDto, Campaign, CreateCampaignDto, CampaignStatus, ScheduleType } from '@/lib/api/campaigns'
import { ApiEndpoints } from '@/config/api'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { CreateCampaignDialog } from '@/components/campaigns/CreateCampaignDialog'
import { ManageTemplatesDialog } from '@/components/campaigns/ManageTemplatesDialog'
import { TemplateSelectionDialog } from '@/components/campaigns/TemplateSelectionDialog'
import { TemplateItem } from '@/components/campaigns/TemplateItem'






export default function CampaignsPage() {
  const [selectedMode, setSelectedMode] = useState<'campaigns' | 'running' | 'draft' | 'paused' | 'completed' | 'deleted'>('campaigns')
  const [searchQuery, setSearchQuery] = useState('')
  const [displayCount, setDisplayCount] = useState(25)
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'a-z' | 'z-a'>('newest')
  const [campaignSortBy, setCampaignSortBy] = useState<'name' | 'status' | 'contacts' | 'sent' | 'groups' | 'dateCreated' | 'lastSent'>('dateCreated')
  const [campaignSortOrder, setCampaignSortOrder] = useState<'asc' | 'desc'>('asc')
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false)
  const [createCampaignData, setCreateCampaignData] = useState(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    const oneMonthLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: timezone })

    return {
      name: '',
      description: '',
      status: CampaignStatus.DRAFT,
      selectedContacts: [] as string[],
      selectedTemplates: [] as string[], // Changed from messageTemplateGroups to selectedTemplates
      sendDevices: [] as string[],
      scheduleType: ScheduleType.NOW,
      scheduledDate: '',
      scheduledTime: '',
      campaignStartDate: today, // Default to today in selected timezone
      campaignEndDate: oneMonthLater, // Default to one month from now in selected timezone
      timezone: timezone,
      sendingWindows: [] as Array<{ startDate: string; startTime: string; endDate: string; endTime: string }>,
      weekdayWindows: {
        monday: [] as Array<{ startTime: string; endTime: string }>,
        tuesday: [] as Array<{ startTime: string; endTime: string }>,
        wednesday: [] as Array<{ startTime: string; endTime: string }>,
        thursday: [] as Array<{ startTime: string; endTime: string }>,
        friday: [] as Array<{ startTime: string; endTime: string }>,
        saturday: [] as Array<{ startTime: string; endTime: string }>,
        sunday: [] as Array<{ startTime: string; endTime: string }>
      },
      weekdayEnabled: {
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false
      },
      excludeDnc: true,
      includePreviouslyMessaged: false
    }
  })
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false)
  const [dateValidationErrors, setDateValidationErrors] = useState({
    startDateError: '',
    endDateError: ''
  })
  const [templateSelectionOpen, setTemplateSelectionOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [uniqueContactCount, setUniqueContactCount] = useState<number>(0)

  // Date validation function
  const validateDates = (startDate: string, endDate: string) => {
    // Get today's date in the selected timezone (same logic as dialog component)
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: createCampaignData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    })
    const errors = { startDateError: '', endDateError: '' }

    // Don't validate start date if schedule type is 'now' (disabled field)
    if (createCampaignData.scheduleType !== 'now' && startDate) {
      // Use proper date comparison like in dialog component
      const startDateInTimezone = new Date(startDate + 'T00:00:00')
      const todayInTimezone = new Date(today + 'T00:00:00')

      if (startDateInTimezone < todayInTimezone) {
        errors.startDateError = 'Campaign start date cannot be before today'
      }
    }

    if (startDate && endDate && endDate < startDate) {
      errors.endDateError = 'Campaign end date cannot be before start date'
    }

    setDateValidationErrors(errors)
    return errors.startDateError === '' && errors.endDateError === ''
  }

  // Update campaign start date when schedule type is "now" or timezone changes
  useEffect(() => {
    if (createCampaignData.scheduleType === 'now' || createCampaignOpen) {
      const currentDate = new Date().toLocaleDateString('en-CA', { timeZone: createCampaignData.timezone })
      if (createCampaignData.campaignStartDate !== currentDate) {
        setCreateCampaignData(prev => ({
          ...prev,
          campaignStartDate: currentDate
        }))
      }
    }
  }, [createCampaignData.scheduleType, createCampaignData.timezone, createCampaignOpen])

  // Validate dates when dialog opens or schedule type changes
  useEffect(() => {
    if (createCampaignOpen) {
      validateDates(createCampaignData.campaignStartDate, createCampaignData.campaignEndDate)
    }
  }, [createCampaignOpen, createCampaignData.scheduleType])

  // Validation functions for each stage
  const validateDetailsStage = () => {
    return createCampaignData.selectedContacts.length > 0 && createCampaignData.selectedTemplates.length > 0
  }

  const validateConfigureStage = () => {
    const hasName = createCampaignData.name.trim() !== ''
    const hasDevices = createCampaignData.sendDevices.length > 0
    const hasValidDates = createCampaignData.campaignStartDate &&
                         createCampaignData.campaignEndDate &&
                         dateValidationErrors.startDateError === '' &&
                         dateValidationErrors.endDateError === ''
    const hasValidSchedule = createCampaignData.scheduleType === 'now' ||
      (createCampaignData.scheduleType === 'later' &&
       createCampaignData.scheduledDate &&
       createCampaignData.scheduledTime) ||
      (createCampaignData.scheduleType === 'windows' &&
       createCampaignData.sendingWindows.length > 0) ||
      (createCampaignData.scheduleType === 'weekday' &&
       Object.entries(createCampaignData.weekdayWindows).some(([day, dayWindows]) =>
         createCampaignData.weekdayEnabled[day as keyof typeof createCampaignData.weekdayEnabled] && dayWindows.length > 0))

    return hasName && hasDevices && hasValidDates && hasValidSchedule
  }

  const canNavigateToTab = (targetTab: string) => {
    if (targetTab === 'details') return true
    if (targetTab === 'configure') return validateDetailsStage()
    if (targetTab === 'preview') return validateDetailsStage() && validateConfigureStage()
    return false
  }

  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Fetch processed contact spreadsheets from API
  const { data: contactSpreadsheetsData } = useQuery({
    queryKey: ['contact-spreadsheets-processed'],
    queryFn: async () => {
      const response = await contactsApi.getSpreadsheets({
        limit: 1000 // Get all spreadsheets
      })
      // Filter only processed spreadsheets
      return response.data.filter(spreadsheet => spreadsheet.status === 'processed' || spreadsheet.status === 'manually_created')
    }
  })

  // Fetch registered devices from API
  const { data: devicesData } = useQuery({
    queryKey: ['devices'],
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.listDevices())
        .then((res) => res.data),
  })

  // Fetch usage plans from API
  const { data: usagePlansData } = useQuery({
    queryKey: ['usage-plans'],
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.getUserUsagePlans())
        .then((res) => res.data),
  })

  // Fetch template groups from API
  const { data: templateGroupsData, refetch: refetchTemplateGroups } = useQuery({
    queryKey: ['template-groups'],
    queryFn: () => campaignsApi.getTemplateGroups(),
  })

  const templateGroups = templateGroupsData || []

  // Fetch campaigns from API
  const { data: campaignsData, refetch: refetchCampaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.getCampaigns(),
  })

  // Fetch deleted campaigns from API
  const { data: deletedCampaignsData, refetch: refetchDeletedCampaigns, isLoading: deletedCampaignsLoading } = useQuery({
    queryKey: ['deleted-campaigns'],
    queryFn: () => campaignsApi.getDeletedCampaigns(),
  })

  const campaigns = campaignsData || []
  const deletedCampaigns = deletedCampaignsData || []

  // Mutations for template groups
  const createTemplateGroupMutation = useMutation({
    mutationFn: campaignsApi.createTemplateGroup,
    onSuccess: () => {
      refetchTemplateGroups()
      queryClient.invalidateQueries({ queryKey: ['template-groups'] })
    },
  })

  const reorderTemplateGroupsMutation = useMutation({
    mutationFn: async ({ sourceIndex, destinationIndex }: { sourceIndex: number; destinationIndex: number }) => {
      // Create a copy of the current template groups array
      const reorderedGroups = [...templateGroups]

      // Remove the item from source index and insert at destination index
      const [movedGroup] = reorderedGroups.splice(sourceIndex, 1)
      reorderedGroups.splice(destinationIndex, 0, movedGroup)

      // Extract the new order of IDs
      const templateGroupIds = reorderedGroups.map(group => group._id)

      // Call the API to persist the new order
      return await campaignsApi.reorderTemplateGroups({ templateGroupIds })
    },
    onMutate: async ({ sourceIndex, destinationIndex }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['template-groups'] })

      // Snapshot the previous value
      const previousTemplateGroups = queryClient.getQueryData(['template-groups'])

      // Optimistically update the cache
      queryClient.setQueryData(['template-groups'], (old: MessageTemplateGroup[] | undefined) => {
        if (!old) return old

        const reorderedGroups = [...old]
        const [movedGroup] = reorderedGroups.splice(sourceIndex, 1)
        reorderedGroups.splice(destinationIndex, 0, movedGroup)

        return reorderedGroups
      })

      // Return a context object with the snapshotted value
      return { previousTemplateGroups }
    },
    onError: (err, variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousTemplateGroups) {
        queryClient.setQueryData(['template-groups'], context.previousTemplateGroups)
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['template-groups'] })
    },
  })

  const updateTemplateGroupMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      campaignsApi.updateTemplateGroup(id, data),
    onSuccess: () => {
      refetchTemplateGroups()
      queryClient.invalidateQueries({ queryKey: ['template-groups'] })
    },
  })

  const deleteTemplateGroupMutation = useMutation({
    mutationFn: campaignsApi.deleteTemplateGroup,
    onSuccess: () => {
      refetchTemplateGroups()
      queryClient.invalidateQueries({ queryKey: ['template-groups'] })
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting template group",
        description: error.response?.data?.message || "An error occurred while deleting the template group.",
        variant: "destructive"
      })
    },
  })

  // Mutations for templates
  const createTemplateMutation = useMutation({
    mutationFn: campaignsApi.createTemplate,
    onSuccess: () => {
      refetchTemplateGroups()
      queryClient.invalidateQueries({ queryKey: ['template-groups'] })
    },
  })

  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      campaignsApi.updateTemplate(id, data),
    onSuccess: () => {
      refetchTemplateGroups()
      queryClient.invalidateQueries({ queryKey: ['template-groups'] })
    },
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: campaignsApi.deleteTemplate,
    onSuccess: () => {
      refetchTemplateGroups()
      queryClient.invalidateQueries({ queryKey: ['template-groups'] })
    },
  })

  // Campaign mutations
  const createCampaignMutation = useMutation({
    mutationFn: campaignsApi.createCampaign,
    onSuccess: (campaign) => {
      refetchCampaigns()
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      toast({
        title: "Campaign created",
        description: `Campaign "${campaign.name}" has been saved as a draft.`
      })
      setCreateCampaignOpen(false)
      // Reset form data
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
      const oneMonthLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: timezone })

      setCreateCampaignData({
        name: '',
        description: '',
        status: CampaignStatus.DRAFT,
        selectedContacts: [],
        selectedTemplates: [],
        sendDevices: [],
        scheduleType: ScheduleType.NOW,
        scheduledDate: '',
        scheduledTime: '',
        campaignStartDate: today,
        campaignEndDate: oneMonthLater,
        timezone: timezone,
        sendingWindows: [],
        weekdayWindows: {
          monday: [],
          tuesday: [],
          wednesday: [],
          thursday: [],
          friday: [],
          saturday: [],
          sunday: []
        },
        weekdayEnabled: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: false,
          sunday: false
        },
        excludeDnc: true,
        includePreviouslyMessaged: false
      })
      setDateValidationErrors({ startDateError: '', endDateError: '' })
    },
    onError: (error: any) => {
      toast({
        title: "Error creating campaign",
        description: error.response?.data?.message || "An error occurred while creating the campaign.",
        variant: "destructive"
      })
    },
  })

  const deleteCampaignMutation = useMutation({
    mutationFn: campaignsApi.deleteCampaign,
    onSuccess: () => {
      refetchCampaigns()
      refetchDeletedCampaigns()
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      queryClient.invalidateQueries({ queryKey: ['deleted-campaigns'] })
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting campaign",
        description: error.response?.data?.message || "An error occurred while deleting the campaign.",
        variant: "destructive"
      })
    },
  })

  const updateCampaignStatusMutation = useMutation({
    mutationFn: ({ campaignId, status }: { campaignId: string; status: CampaignStatus }) =>
      campaignsApi.updateCampaignStatus(campaignId, { status }),
    onSuccess: (updatedCampaign) => {
      refetchCampaigns()
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      const statusText = updatedCampaign.status === CampaignStatus.RUNNING ? 'started' :
                        updatedCampaign.status === CampaignStatus.PAUSED ? 'paused' : 'updated'
      toast({
        title: "Campaign updated",
        description: `Campaign "${updatedCampaign.name}" has been ${statusText}.`
      })
    },
    onError: (error: any) => {
      toast({
        title: "Error updating campaign",
        description: error.response?.data?.message || "An error occurred while updating the campaign.",
        variant: "destructive"
      })
    },
  })

  const restoreCampaignMutation = useMutation({
    mutationFn: campaignsApi.restoreCampaign,
    onSuccess: (restoredCampaign) => {
      refetchCampaigns()
      refetchDeletedCampaigns()
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      queryClient.invalidateQueries({ queryKey: ['deleted-campaigns'] })
      toast({
        title: "Campaign restored",
        description: `Campaign "${restoredCampaign.name}" has been restored.`
      })
    },
    onError: (error: any) => {
      toast({
        title: "Error restoring campaign",
        description: error.response?.data?.message || "An error occurred while restoring the campaign.",
        variant: "destructive"
      })
    },
  })



  // Fetch unique contact count when selected contacts change
  useEffect(() => {
    const fetchUniqueContactCount = async () => {
      if (createCampaignData.selectedContacts.length === 0) {
        setUniqueContactCount(0)
        return
      }

      try {
        const result = await contactsApi.getUniqueContactCount(
          createCampaignData.selectedContacts,
          createCampaignData.excludeDnc,
          createCampaignData.includePreviouslyMessaged
        )
        setUniqueContactCount(result.uniqueContactCount)
      } catch (error) {
        console.error('Failed to fetch unique contact count:', error)
        setUniqueContactCount(0)
      }
    }

    fetchUniqueContactCount()
  }, [createCampaignData.selectedContacts, createCampaignData.excludeDnc, createCampaignData.includePreviouslyMessaged])

  // Filter and sort campaigns based on selected mode
  const filteredAndSortedCampaigns = useMemo(() => {
    let filtered: Campaign[]

    if (selectedMode === 'deleted') {
      filtered = deletedCampaigns
    } else if (selectedMode === 'campaigns') {
      filtered = campaigns
    } else {
      filtered = campaigns.filter(campaign => campaign.status === selectedMode)
    }

    if (searchQuery) {
      filtered = filtered.filter(campaign =>
        campaign.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        campaign.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Sort campaigns
    const sorted = [...filtered].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (campaignSortBy) {
        case 'name':
          aValue = a.name.toLowerCase()
          bValue = b.name.toLowerCase()
          break
        case 'status':
          aValue = a.status
          bValue = b.status
          break
        case 'contacts':
          aValue = a.totalMessages
          bValue = b.totalMessages
          break
        case 'sent':
          aValue = a.sentMessages
          bValue = b.sentMessages
          break
        case 'groups':
          aValue = a.selectedContacts.length
          bValue = b.selectedContacts.length
          break
        case 'dateCreated':
          aValue = new Date(a.createdAt).getTime()
          bValue = new Date(b.createdAt).getTime()
          break
        case 'lastSent':
          aValue = a.lastMessageSentAt ? new Date(a.lastMessageSentAt).getTime() : 0
          bValue = b.lastMessageSentAt ? new Date(b.lastMessageSentAt).getTime() : 0
          break
        default:
          return 0
      }

      if (aValue < bValue) {
        return campaignSortOrder === 'asc' ? -1 : 1
      }
      if (aValue > bValue) {
        return campaignSortOrder === 'asc' ? 1 : -1
      }
      return 0
    })

    return sorted
  }, [campaigns, deletedCampaigns, selectedMode, searchQuery, campaignSortBy, campaignSortOrder])

  const [totalCampaigns, totalRunning, totalDraft, totalPaused, totalCompleted, totalDeleted] = useMemo(() => {
    const total = campaigns.length
    const running = campaigns.filter(c => c.status === CampaignStatus.RUNNING).length
    const draft = campaigns.filter(c => c.status === CampaignStatus.DRAFT).length
    const paused = campaigns.filter(c => c.status === CampaignStatus.PAUSED).length
    const completed = campaigns.filter(c => c.status === CampaignStatus.COMPLETED).length
    const deleted = deletedCampaigns.length

    return [total, running, draft, paused, completed, deleted]
  }, [campaigns, deletedCampaigns])

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedCampaigns(filteredAndSortedCampaigns.map(campaign => campaign._id))
    } else {
      setSelectedCampaigns([])
    }
  }

  const handleSelectCampaign = (campaignId: string, checked: boolean) => {
    if (checked) {
      setSelectedCampaigns([...selectedCampaigns, campaignId])
    } else {
      setSelectedCampaigns(selectedCampaigns.filter(id => id !== campaignId))
    }
  }

  const handleCreateCampaign = async () => {
    if (!createCampaignData.name.trim()) {
      toast({
        title: "Campaign name required",
        description: "Please enter a name for the campaign.",
        variant: "destructive"
      })
      return
    }

    if (createCampaignData.selectedContacts.length === 0) {
      toast({
        title: "Contacts required",
        description: "Please select at least one contact spreadsheet.",
        variant: "destructive"
      })
      return
    }

    if (createCampaignData.selectedTemplates.length === 0) {
      toast({
        title: "Templates required",
        description: "Please select at least one message template.",
        variant: "destructive"
      })
      return
    }

    if (createCampaignData.sendDevices.length === 0) {
      toast({
        title: "Devices required",
        description: "Please select at least one device to send messages from.",
        variant: "destructive"
      })
      return
    }

    // Prepare the campaign data for API
    const campaignDto: CreateCampaignDto = {
      name: createCampaignData.name.trim(),
      description: createCampaignData.description?.trim() || undefined,
      selectedContacts: createCampaignData.selectedContacts,
      selectedTemplates: createCampaignData.selectedTemplates,
      sendDevices: createCampaignData.sendDevices,
      scheduleType: createCampaignData.scheduleType,
      scheduledDate: createCampaignData.scheduledDate || undefined,
      scheduledTime: createCampaignData.scheduledTime || undefined,
      campaignStartDate: createCampaignData.campaignStartDate,
      campaignEndDate: createCampaignData.campaignEndDate,
      timezone: createCampaignData.timezone,
      sendingWindows: createCampaignData.sendingWindows?.length > 0 ? createCampaignData.sendingWindows : undefined,
      weekdayWindows: createCampaignData.weekdayWindows,
      weekdayEnabled: createCampaignData.weekdayEnabled,
      excludeDnc: createCampaignData.excludeDnc,
      includePreviouslyMessaged: createCampaignData.includePreviouslyMessaged,
    }

    // Create the campaign via API
    await createCampaignMutation.mutateAsync(campaignDto)
  }

  const handleDeleteSelectedCampaigns = async () => {
    if (selectedCampaigns.length === 0) return

    const campaignCount = selectedCampaigns.length
    const campaignText = campaignCount === 1 ? 'campaign' : 'campaigns'

    if (!confirm(`Are you sure you want to delete ${campaignCount} ${campaignText}? You can restore them later from the Deleted view.`)) {
      return
    }

    try {
      // Delete each campaign via API (soft delete)
      await Promise.all(selectedCampaigns.map(campaignId =>
        deleteCampaignMutation.mutateAsync(campaignId)
      ))

      setSelectedCampaigns([])

      toast({
        title: "Success",
        description: `Deleted ${campaignCount} ${campaignText} successfully`
      })
    } catch (error) {
      console.error('Error deleting campaigns:', error)
    }
  }

  const handleRestoreSelectedCampaigns = async () => {
    if (selectedCampaigns.length === 0) return

    const campaignCount = selectedCampaigns.length
    const campaignText = campaignCount === 1 ? 'campaign' : 'campaigns'

    if (!confirm(`Are you sure you want to restore ${campaignCount} ${campaignText}?`)) {
      return
    }

    try {
      // Restore each campaign via API
      await Promise.all(selectedCampaigns.map(campaignId =>
        restoreCampaignMutation.mutateAsync(campaignId)
      ))

      setSelectedCampaigns([])

      toast({
        title: "Success",
        description: `Restored ${campaignCount} ${campaignText} successfully`
      })
    } catch (error) {
      console.error('Error restoring campaigns:', error)
    }
  }

  const handleRunCampaign = async (campaignId: string) => {
    try {
      await updateCampaignStatusMutation.mutateAsync({
        campaignId,
        status: CampaignStatus.RUNNING
      })
    } catch (error) {
      console.error('Error running campaign:', error)
    }
  }

  const handlePauseCampaign = async (campaignId: string) => {
    try {
      await updateCampaignStatusMutation.mutateAsync({
        campaignId,
        status: CampaignStatus.PAUSED
      })
    } catch (error) {
      console.error('Error pausing campaign:', error)
    }
  }


  const handleCampaignSort = (column: 'name' | 'status' | 'contacts' | 'sent' | 'groups' | 'dateCreated' | 'lastSent') => {
    if (campaignSortBy === column) {
      setCampaignSortOrder(campaignSortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setCampaignSortBy(column)
      setCampaignSortOrder('asc')
    }
    setCurrentPage(1)
  }

  const renderSortIcon = (column: 'name' | 'status' | 'contacts' | 'sent' | 'groups' | 'dateCreated' | 'lastSent') => {
    if (campaignSortBy !== column) return null
    return campaignSortOrder === 'asc' ?
      <ChevronUp className="h-4 w-4 ml-1" /> :
      <ChevronDown className="h-4 w-4 ml-1" />
  }

  const isAllSelected = selectedCampaigns.length === filteredAndSortedCampaigns.length && filteredAndSortedCampaigns.length > 0
  const isSomeSelected = selectedCampaigns.length > 0

  const getStatusDisplay = (status: CampaignStatus, campaignId: string, isDeleted: boolean = false) => {
    const statusConfig = {
      [CampaignStatus.DRAFT]: { dot: 'bg-gray-400', text: 'Draft' },
      [CampaignStatus.SCHEDULED]: { dot: 'bg-yellow-500', text: 'Scheduled' },
      [CampaignStatus.RUNNING]: { dot: 'bg-green-500', text: 'Running' },
      [CampaignStatus.PAUSED]: { dot: 'bg-orange-500', text: 'Paused' },
      [CampaignStatus.COMPLETED]: { dot: 'bg-blue-500', text: 'Completed' },
      [CampaignStatus.FAILED]: { dot: 'bg-red-500', text: 'Failed' },
      [CampaignStatus.CANCELLED]: { dot: 'bg-red-400', text: 'Cancelled' }
    }

    const config = statusConfig[status] || { dot: 'bg-gray-400', text: status }

    return (
      <div className='flex items-center gap-1 md:gap-2'>
        <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${config.dot}`} />
        <span className='text-xs md:text-sm'>{config.text}</span>
        {isDeleted ? (
          <Button
            size='sm'
            variant='outline'
            className='ml-1 md:ml-2 gap-1 text-xs md:text-sm'
            onClick={(e) => {
              e.stopPropagation()
              restoreCampaignMutation.mutateAsync(campaignId)
            }}
            disabled={restoreCampaignMutation.isPending}
          >
            <RotateCcw className='h-2 w-2 md:h-3 md:w-3' />
            <span className='hidden md:inline'>Restore</span>
          </Button>
        ) : (
          <>
            {status === CampaignStatus.DRAFT && (
              <Button
                size='sm'
                variant='outline'
                className='ml-1 md:ml-2 gap-1 text-xs md:text-sm'
                onClick={(e) => {
                  e.stopPropagation()
                  handleRunCampaign(campaignId)
                }}
                disabled={updateCampaignStatusMutation.isPending}
              >
                <Play className='h-2 w-2 md:h-3 md:w-3' />
                <span className='hidden md:inline'>Run</span>
              </Button>
            )}
            {status === CampaignStatus.RUNNING && (
              <Button
                size='sm'
                variant='outline'
                className='ml-1 md:ml-2 gap-1 text-xs md:text-sm'
                onClick={(e) => {
                  e.stopPropagation()
                  handlePauseCampaign(campaignId)
                }}
                disabled={updateCampaignStatusMutation.isPending}
              >
                <Pause className='h-2 w-2 md:h-3 md:w-3' />
                <span className='hidden md:inline'>Pause</span>
              </Button>
            )}
            {status === CampaignStatus.PAUSED && (
              <Button
                size='sm'
                variant='outline'
                className='ml-1 md:ml-2 gap-1 text-xs md:text-sm'
                onClick={(e) => {
                  e.stopPropagation()
                  handleRunCampaign(campaignId)
                }}
                disabled={updateCampaignStatusMutation.isPending}
              >
                <Play className='h-2 w-2 md:h-3 md:w-3' />
                <span className='hidden md:inline'>Run</span>
              </Button>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className='flex h-full overflow-hidden'>
      {/* Sidebar */}
      <div className='w-64 border-r bg-background/50 p-4 flex flex-col h-full overflow-hidden'>
        <div className='space-y-2 flex-shrink-0'>
          <Button
            variant={selectedMode === 'campaigns' ? 'default' : 'ghost'}
            className='w-full justify-start text-sm'
            onClick={() => {
              setSelectedMode('campaigns')
              setCurrentPage(1)
              setSearchQuery('')
            }}
          >
            <Megaphone className='mr-2 h-4 w-4' />
            Campaigns ({totalCampaigns})
          </Button>
          <Button
            variant={selectedMode === 'running' ? 'default' : 'ghost'}
            className='w-full justify-start text-sm'
            onClick={() => {
              setSelectedMode('running')
              setCurrentPage(1)
              setSearchQuery('')
            }}
          >
            <Users className='mr-2 h-4 w-4' />
            Running campaigns ({totalRunning})
          </Button>
          <Button
            variant={selectedMode === 'draft' ? 'default' : 'ghost'}
            className='w-full justify-start text-sm'
            onClick={() => {
              setSelectedMode('draft')
              setCurrentPage(1)
              setSearchQuery('')
            }}
          >
            <Edit className='mr-2 h-4 w-4' />
            Draft campaigns ({totalDraft})
          </Button>
          <Button
            variant={selectedMode === 'paused' ? 'default' : 'ghost'}
            className='w-full justify-start text-sm'
            onClick={() => {
              setSelectedMode('paused')
              setCurrentPage(1)
              setSearchQuery('')
            }}
          >
            <X className='mr-2 h-4 w-4' />
            Paused campaigns ({totalPaused})
          </Button>
          <Button
            variant={selectedMode === 'completed' ? 'default' : 'ghost'}
            className='w-full justify-start text-sm'
            onClick={() => {
              setSelectedMode('completed')
              setCurrentPage(1)
              setSearchQuery('')
            }}
          >
            <Check className='mr-2 h-4 w-4' />
            Completed campaigns ({totalCompleted})
          </Button>
          <Button
            variant={selectedMode === 'deleted' ? 'default' : 'ghost'}
            className='w-full justify-start text-sm'
            onClick={() => {
              setSelectedMode('deleted')
              setCurrentPage(1)
              setSearchQuery('')
            }}
          >
            <Archive className='mr-2 h-4 w-4' />
            Deleted campaigns ({totalDeleted})
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className='flex-1 flex flex-col h-full overflow-hidden'>
        {/* Header */}
        <div className='border-b p-4 flex-shrink-0'>
          <div className='flex items-center justify-between mb-4'>
            <h2 className='text-base md:text-lg lg:text-xl font-semibold'>
              {selectedMode === 'campaigns' && 'Campaigns'}
              {selectedMode === 'running' && 'Running campaigns'}
              {selectedMode === 'draft' && 'Draft campaigns'}
              {selectedMode === 'paused' && 'Paused campaigns'}
              {selectedMode === 'completed' && 'Completed campaigns'}
              {selectedMode === 'deleted' && 'Deleted campaigns'}
            </h2>
            <div className='relative w-full md:w-80'>
              <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-3 w-3 md:h-4 md:w-4 text-muted-foreground' />
              <Input
                placeholder='Search campaigns...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='pl-8 md:pl-10 text-sm md:text-base'
              />
            </div>
          </div>

          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-4'>
              <CreateCampaignDialog
                open={createCampaignOpen}
                onOpenChange={setCreateCampaignOpen}
                campaignData={createCampaignData}
                onCampaignDataChange={setCreateCampaignData}
                contactSpreadsheets={contactSpreadsheetsData}
                devices={devicesData?.data}
                usagePlans={usagePlansData?.data}
                templateGroups={templateGroups}
                uniqueContactCount={uniqueContactCount}
                dateValidationErrors={dateValidationErrors}
                onDateValidationChange={setDateValidationErrors}
                onManageTemplatesOpen={() => setManageTemplatesOpen(true)}
                onTemplateSelectionOpen={() => setTemplateSelectionOpen(true)}
                onCreateCampaign={handleCreateCampaign}
              />

              <Button className='gap-1 md:gap-2 text-xs md:text-sm' onClick={() => setCreateCampaignOpen(true)}>
                <Plus className='h-3 w-3 md:h-4 md:w-4' />
                <span className='hidden sm:inline'>Create new campaign</span>
                <span className='sm:hidden'>Campaign</span>
              </Button>

              <ManageTemplatesDialog
                open={manageTemplatesOpen}
                onOpenChange={setManageTemplatesOpen}
                templateGroups={templateGroups}
                onCreateTemplateGroup={async (data) => {
                  await createTemplateGroupMutation.mutateAsync(data)
                }}
                onDeleteTemplateGroup={async (id) => {
                  await deleteTemplateGroupMutation.mutateAsync(id)
                }}
                onReorderTemplateGroups={async (sourceIndex, destinationIndex) => {
                  await reorderTemplateGroupsMutation.mutateAsync({ sourceIndex, destinationIndex })
                }}
                onCreateTemplate={async (data) => {
                  await createTemplateMutation.mutateAsync(data)
                }}
                onUpdateTemplate={async (id, data) => {
                  await updateTemplateMutation.mutateAsync({ id, data })
                }}
                onDeleteTemplate={async (id) => {
                  await deleteTemplateMutation.mutateAsync(id)
                }}
              />

              {/* Template Selection Dialog */}
              <TemplateSelectionDialog
                open={templateSelectionOpen}
                onOpenChange={setTemplateSelectionOpen}
                templateGroups={templateGroups}
                campaignData={createCampaignData}
                onCampaignDataChange={setCreateCampaignData}
                expandedGroups={expandedGroups}
                onExpandedGroupsChange={setExpandedGroups}
              />
            </div>

            <div className='flex items-center gap-4'>
              {isSomeSelected && (
                <div className='flex items-center gap-2'>
                  <Badge variant='secondary'>{selectedCampaigns.length} selected</Badge>
                  {selectedMode === 'deleted' ? (
                    <Button
                      size='sm'
                      variant='outline'
                      className='gap-2'
                      onClick={handleRestoreSelectedCampaigns}
                    >
                      <RotateCcw className='h-4 w-4' />
                      Restore campaign(s)
                    </Button>
                  ) : (
                    <Button
                      size='sm'
                      variant='outline'
                      className='gap-2'
                      onClick={handleDeleteSelectedCampaigns}
                    >
                      <Trash2 className='h-4 w-4' />
                      Delete campaign(s)
                    </Button>
                  )}
                </div>
              )}
              <div className='flex items-center gap-2'>
                <span className='text-sm text-muted-foreground'>Display:</span>
                <Select value={displayCount.toString()} onValueChange={(value) => setDisplayCount(parseInt(value))}>
                  <SelectTrigger className='w-20'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='25'>25</SelectItem>
                    <SelectItem value='100'>100</SelectItem>
                    <SelectItem value='250'>250</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Table or Empty State */}
        <div className='flex-1 overflow-y-auto'>
          {(campaignsLoading || (selectedMode === 'deleted' && deletedCampaignsLoading)) ? (
            <div className='flex items-center justify-center h-full'>
              <div className='text-muted-foreground'>Loading...</div>
            </div>
          ) : (selectedMode === 'deleted' && totalDeleted === 0) ? (
            <div className='flex flex-col items-center justify-center h-full py-16'>
              <Archive className='h-12 w-12 md:h-16 md:w-16 text-muted-foreground/50 mb-4' />
              <h3 className='text-base md:text-lg font-semibold text-muted-foreground mb-2'>No deleted campaigns</h3>
              <p className='text-xs md:text-sm text-muted-foreground mb-6 text-center max-w-md'>
                When you delete campaigns, they will appear here and can be restored.
              </p>
            </div>
          ) : (selectedMode !== 'deleted' && totalCampaigns === 0) ? (
            <div className='flex flex-col items-center justify-center h-full py-16'>
              <Megaphone className='h-12 w-12 md:h-16 md:w-16 text-muted-foreground/50 mb-4' />
              <h3 className='text-base md:text-lg font-semibold text-muted-foreground mb-2'>No campaigns</h3>
              <p className='text-xs md:text-sm text-muted-foreground mb-6 text-center max-w-md'>
                Create your first campaign to start reaching your contacts.
              </p>
              <Button className='gap-1 md:gap-2 text-xs md:text-sm' onClick={() => setCreateCampaignOpen(true)}>
                <Plus className='h-3 w-3 md:h-4 md:w-4' />
                <span className='hidden sm:inline'>Create new campaign</span>
                <span className='sm:hidden'>Campaign</span>
              </Button>
            </div>
          ) : (
            <table className='w-full'>
              <thead className='sticky top-0 z-10 border-b bg-muted'>
                <tr>
                  <th className='w-8 md:w-12 p-2 md:p-4'>
                    <Checkbox
                      checked={isAllSelected}
                      onCheckedChange={handleSelectAll}
                    />
                  </th>
                  <th
                    className='text-left p-2 md:p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors text-xs md:text-sm lg:text-base'
                    onClick={() => handleCampaignSort('name')}
                  >
                    <div className='flex items-center'>
                      Campaign name
                      {renderSortIcon('name')}
                    </div>
                  </th>
                  <th
                    className='text-left p-2 md:p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors text-xs md:text-sm lg:text-base'
                    onClick={() => handleCampaignSort('status')}
                  >
                    <div className='flex items-center'>
                      Status
                      {renderSortIcon('status')}
                    </div>
                  </th>
                  <th
                    className='text-left p-2 md:p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors text-xs md:text-sm lg:text-base'
                    onClick={() => handleCampaignSort('contacts')}
                  >
                    <div className='flex items-center'>
                      Contacts
                      {renderSortIcon('contacts')}
                    </div>
                  </th>
                  <th
                    className='text-left p-2 md:p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors text-xs md:text-sm lg:text-base'
                    onClick={() => handleCampaignSort('sent')}
                  >
                    <div className='flex items-center'>
                      Sent
                      {renderSortIcon('sent')}
                    </div>
                  </th>
                  <th
                    className='text-left p-2 md:p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors text-xs md:text-sm lg:text-base'
                    onClick={() => handleCampaignSort('groups')}
                  >
                    <div className='flex items-center'>
                      Groups
                      {renderSortIcon('groups')}
                    </div>
                  </th>
                  <th
                    className='text-left p-2 md:p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors text-xs md:text-sm lg:text-base'
                    onClick={() => handleCampaignSort('dateCreated')}
                  >
                    <div className='flex items-center'>
                      Date created
                      {renderSortIcon('dateCreated')}
                    </div>
                  </th>
                  <th
                    className='text-left p-2 md:p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors text-xs md:text-sm lg:text-base'
                    onClick={() => handleCampaignSort('lastSent')}
                  >
                    <div className='flex items-center'>
                      Last sent
                      {renderSortIcon('lastSent')}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedCampaigns.map((campaign) => (
                  <tr
                    key={campaign._id}
                    className='border-b hover:bg-muted/25 transition-colors'
                  >
                    <td className='p-2 md:p-4'>
                      <Checkbox
                        checked={selectedCampaigns.includes(campaign._id)}
                        onCheckedChange={(checked) => handleSelectCampaign(campaign._id, checked as boolean)}
                      />
                    </td>
                    <td className='p-2 md:p-4'>
                      <div className='flex items-center gap-1 md:gap-2'>
                        <Megaphone className='h-3 w-3 md:h-4 md:w-4 text-muted-foreground' />
                        <div>
                          <div className='font-medium text-xs md:text-sm lg:text-base'>{campaign.name}</div>
                          {campaign.description && (
                            <div className='text-xs md:text-xs lg:text-sm text-muted-foreground'>
                              {campaign.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className='p-2 md:p-4'>
                      {getStatusDisplay(campaign.status, campaign._id, selectedMode === 'deleted')}
                    </td>
                    <td className='p-2 md:p-4 text-muted-foreground text-xs md:text-sm lg:text-base'>
                      {campaign.totalMessages.toLocaleString()}
                    </td>
                    <td className='p-2 md:p-4 text-muted-foreground text-xs md:text-sm lg:text-base'>
                      {campaign.sentMessages.toLocaleString()}
                    </td>
                    <td className='p-2 md:p-4 text-muted-foreground text-xs md:text-sm lg:text-base'>
                      {campaign.selectedContacts.length}
                    </td>
                    <td className='p-2 md:p-4 text-muted-foreground'>
                      <div className='flex flex-col'>
                        <span className='text-xs md:text-xs lg:text-sm'>{new Date(campaign.createdAt).toLocaleDateString()}</span>
                        <span className='text-xs md:text-xs lg:text-xs text-muted-foreground'>
                          {new Date(campaign.createdAt).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </span>
                      </div>
                    </td>
                    <td className='p-2 md:p-4 text-muted-foreground'>
                      {campaign.lastMessageSentAt ? (
                        <div className='flex flex-col'>
                          <span className='text-xs md:text-xs lg:text-sm'>{new Date(campaign.lastMessageSentAt).toLocaleDateString()}</span>
                          <span className='text-xs md:text-xs lg:text-xs text-muted-foreground'>
                            {new Date(campaign.lastMessageSentAt).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </span>
                        </div>
                      ) : <span className='text-xs md:text-xs lg:text-sm'>-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination - Always at bottom */}
        <div className='border-t p-4 mt-auto flex-shrink-0'>
          {totalCampaigns > 0 ? (
            <div className='flex items-center justify-between'>
              <div className='text-sm text-muted-foreground'>
                Showing 1-{Math.min(displayCount, filteredAndSortedCampaigns.length)} of {filteredAndSortedCampaigns.length} campaigns
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className='h-4 w-4' />
                  Previous
                </Button>
                <span className='text-sm text-muted-foreground'>
                  Page {currentPage} of {Math.ceil(filteredAndSortedCampaigns.length / displayCount) || 1}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setCurrentPage(Math.min(Math.ceil(filteredAndSortedCampaigns.length / displayCount), currentPage + 1))}
                  disabled={currentPage >= Math.ceil(filteredAndSortedCampaigns.length / displayCount)}
                >
                  Next
                  <ChevronRight className='h-4 w-4' />
                </Button>
              </div>
            </div>
          ) : (
            <div className='h-0'></div>
          )}
        </div>
      </div>
    </div>
  )
}


