'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Inbox as InboxIcon, Calendar, ChevronDown, Search, Edit, Save, X, Plus, MessageSquarePlus, Mail, MailOpen, MessageCircle, Clock, Users, Megaphone, Star, Archive, Trash2, ArchiveRestore, Smartphone } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ApiEndpoints } from '@/config/api'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { contactsApi } from '@/lib/api/contacts'
import { campaignsApi } from '@/lib/api/campaigns'
import { cn, normalizePhoneNumber, formatMessageTime, groupMessagesWithDateSeparators, groupMessagesWithMetadataChanges, MessageWithDate, MessageGroup, getStatusDisplay, MessageStatus, formatPhoneNumberDisplay } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { ConversationSummary, ConversationsResponse } from '@/lib/types'

// Using ConversationSummary from types.ts
type Conversation = ConversationSummary

interface Message {
  _id: string
  message: string
  sender?: string
  recipient?: string
  receivedAt?: Date
  requestedAt?: Date
  type: string
  status: string
  device: string | { _id: string }
  senderPhoneNumber?: string
}

function DateSeparator({ dateLabel }: { dateLabel: string }) {
  return (
    <div className="flex items-center justify-center my-4">
      <div className="bg-muted/80 text-muted-foreground text-xs px-3 py-1 rounded-full">
        {dateLabel}
      </div>
    </div>
  )
}

function MetadataChangeSeparator({ deviceId, phoneNumber }: { deviceId: string; phoneNumber: string }) {
  const deviceDisplay = deviceId || 'Device unknown'
  const phoneDisplay = phoneNumber ? formatPhoneNumberDisplay(phoneNumber) : 'Phone unknown'
  const displayText = `${deviceDisplay} - ${phoneDisplay}`

  return (
    <div className="flex items-center justify-center my-4">
      <div className="bg-yellow-50 text-yellow-800 text-xs px-3 py-1 rounded-full">
        {displayText}
      </div>
    </div>
  )
}

function MessageStatusIndicator({ status, isIncoming }: { status: MessageStatus; isIncoming: boolean }) {
  // Only show status for outgoing messages (sent by user)
  if (isIncoming) return null

  const statusInfo = getStatusDisplay(status)

  return (
    <div className="text-xs text-muted-foreground flex items-center gap-1">
      <span className="font-mono text-xs">
        {statusInfo.icon}
      </span>
      <span>
        {statusInfo.label}
      </span>
    </div>
  )
}

function ConversationRow({
  conversation,
  isSelected,
  onClick,
  isChecked,
  onCheckboxChange,
  onStarToggle
}: {
  conversation: Conversation
  isSelected: boolean
  onClick: () => void
  isChecked: boolean
  onCheckboxChange: (checked: boolean) => void
  onStarToggle: () => void
}) {
  const displayName = conversation.contact?.firstName || conversation.contact?.lastName
    ? `${conversation.contact.firstName || ''} ${conversation.contact.lastName || ''}`.trim()
    : formatPhoneNumberDisplay(conversation.normalizedPhoneNumber)

  const formatDate = (date: Date | string) => {
    const dateObj = date instanceof Date ? date : new Date(date)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const messageDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())
    
    if (messageDate.getTime() === today.getTime()) {
      return dateObj.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    } else if (messageDate.getTime() === today.getTime() - 24 * 60 * 60 * 1000) {
      return 'Yesterday'
    } else {
      return dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      })
    }
  }

  return (
    <div
      className={cn(
        'p-4 border-b hover:bg-muted/50 transition-colors',
        isSelected && 'bg-primary/10 border-l-4 border-l-primary'
      )}
    >
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Checkbox
            checked={isChecked}
            onCheckedChange={onCheckboxChange}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onStarToggle()
            }}
            className="text-muted-foreground hover:text-yellow-500 transition-colors"
          >
            <Star
              className={cn(
                "h-4 w-4",
                conversation.isStarred && "fill-yellow-500 text-yellow-500"
              )}
            />
          </button>
          <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
            <div className="flex items-center gap-2">
              <h3 className={cn(
                "text-sm truncate",
                conversation.unseenCount > 0 ? "font-semibold text-foreground" : "font-medium"
              )}>
                {displayName}
              </h3>
              {conversation.firstCampaignName && (
                <Badge
                  variant="secondary"
                  className="h-5 px-1.5 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                >
                  {conversation.firstCampaignName}
                </Badge>
              )}
              {conversation.unseenCount > 0 && (
                <Badge
                  variant="default"
                  className="h-5 min-w-[20px] px-1.5 text-xs bg-primary text-primary-foreground"
                >
                  {conversation.unseenCount}
                </Badge>
              )}
            </div>
            <p className={cn(
              "text-sm truncate mt-1",
              conversation.unseenCount > 0 ? "text-foreground font-medium" : "text-muted-foreground"
            )}>
              {conversation.lastMessage.isIncoming ? '' : 'You: '}{conversation.lastMessage.message}
            </p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground ml-2 flex-shrink-0">
          {formatDate(conversation.lastMessageDate)}
        </div>
      </div>
    </div>
  )
}

function ConversationList({
  conversations,
  selectedConversation,
  onSelectConversation,
  sortBy,
  setSortBy,
  dateFilter,
  setDateFilter,
  dateRange,
  setDateRange,
  searchQuery,
  setSearchQuery,
  onNewMessage,
  checkedConversations,
  onCheckboxChange,
  onStarToggle,
  onArchiveConversations,
  onBlockContacts,
  onUnarchiveConversations,
  onUnblockContacts,
  currentView,
  hasNextPage,
  isFetchingNextPage,
  isFetching,
  onLoadMore,
  campaignsForFilter,
  selectedCampaignFilters,
  setSelectedCampaignFilters
}: {
  conversations: Conversation[]
  selectedConversation: Conversation | null
  onSelectConversation: (conversation: Conversation) => void
  sortBy: string
  setSortBy: (value: string) => void
  dateFilter: string
  setDateFilter: (value: string) => void
  dateRange: { from?: Date; to?: Date } | undefined
  setDateRange: (range: { from?: Date; to?: Date } | undefined) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  onNewMessage: () => void
  checkedConversations: Set<string>
  onCheckboxChange: (phoneNumber: string, checked: boolean) => void
  onStarToggle: (phoneNumber: string) => void
  onArchiveConversations: () => void
  onBlockContacts: () => void
  onUnarchiveConversations: () => void
  onUnblockContacts: () => void
  currentView: string
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetching: boolean
  onLoadMore: () => void
  campaignsForFilter: any[]
  selectedCampaignFilters: string[]
  setSelectedCampaignFilters: (campaignIds: string[]) => void
}) {
  const [showDatePicker, setShowDatePicker] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, onLoadMore])

  const filteredAndSortedConversations = useMemo(() => {
    let filtered = conversations

    // Apply search filter (client-side for now - could be moved to backend later)
    if (searchQuery.trim()) {
      filtered = filtered.filter(conv => {
        const displayName = conv.contact?.firstName || conv.contact?.lastName
          ? `${conv.contact.firstName || ''} ${conv.contact.lastName || ''}`.trim()
          : formatPhoneNumberDisplay(conv.normalizedPhoneNumber)
        return displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
               conv.normalizedPhoneNumber.includes(searchQuery) ||
               conv.phoneNumber.includes(searchQuery)
      })
    }

    // Apply date filter (client-side for now - could be moved to backend later)
    if (dateFilter === 'custom' && dateRange?.from) {
      filtered = filtered.filter(conv => {
        const messageDate = new Date(conv.lastMessageDate)
        if (dateRange.to) {
          return messageDate >= dateRange.from && messageDate <= dateRange.to
        } else {
          return messageDate >= dateRange.from
        }
      })
    }

    // Sorting is handled by backend, but we keep this for client-side search results
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          const dateA = a.lastMessageDate instanceof Date ? a.lastMessageDate : new Date(a.lastMessageDate)
          const dateB = b.lastMessageDate instanceof Date ? b.lastMessageDate : new Date(b.lastMessageDate)
          return dateB.getTime() - dateA.getTime()
        case 'firstName':
          const nameA = a.contact?.firstName || a.normalizedPhoneNumber
          const nameB = b.contact?.firstName || b.normalizedPhoneNumber
          return nameA.localeCompare(nameB)
        case 'lastName':
          const lastNameA = a.contact?.lastName || a.normalizedPhoneNumber
          const lastNameB = b.contact?.lastName || b.normalizedPhoneNumber
          return lastNameA.localeCompare(lastNameB)
        default:
          const defaultDateA = a.lastMessageDate instanceof Date ? a.lastMessageDate : new Date(a.lastMessageDate)
          const defaultDateB = b.lastMessageDate instanceof Date ? b.lastMessageDate : new Date(b.lastMessageDate)
          return defaultDateB.getTime() - defaultDateA.getTime()
      }
    })

    return sorted
  }, [conversations, searchQuery, dateFilter, dateRange, sortBy])

  return (
    <div className="flex flex-col h-full">
      {/* Header with filters */}
      <div className="p-4 border-b space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Conversations</h2>
          <div className="flex items-center gap-2">
            {checkedConversations.size > 0 && (
              <>
                {currentView === 'archived' ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onUnarchiveConversations}
                      className="gap-2"
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      Unarchive
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onBlockContacts}
                      className="gap-2 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                      Block Contact
                    </Button>
                  </>
                ) : currentView === 'spam' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onUnblockContacts}
                    className="gap-2"
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    Unblock Contact
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onArchiveConversations}
                      className="gap-2"
                    >
                      <Archive className="h-4 w-4" />
                      Archive Conversation
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onBlockContacts}
                      className="gap-2 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                      Block Contact
                    </Button>
                  </>
                )}
              </>
            )}
            <Button
              size="sm"
              onClick={onNewMessage}
              className="gap-2"
            >
              <MessageSquarePlus className="h-4 w-4" />
              New message
            </Button>
          </div>
        </div>
        
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filters */}
        <div className="flex space-x-2">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort by:" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="firstName">First name</SelectItem>
              <SelectItem value="lastName">Last name</SelectItem>
            </SelectContent>
          </Select>

          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Date:" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-[240px] justify-between">
                <span className="truncate">
                  {selectedCampaignFilters.length === 0
                    ? "All campaigns"
                    : selectedCampaignFilters.length === 1
                    ? campaignsForFilter.find(c => c._id === selectedCampaignFilters[0])?.name || "Unknown campaign"
                    : `Filtering for ${selectedCampaignFilters.length} campaigns`
                  }
                </span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[260px]" align="start">
              <DropdownMenuCheckboxItem
                checked={selectedCampaignFilters.length === 0}
                onCheckedChange={() => {
                  console.log('🔄 All campaigns selected - clearing filters')
                  setSelectedCampaignFilters([])
                }}
                onSelect={(e) => e.preventDefault()}
                className="font-semibold bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/30 focus:bg-blue-100 dark:focus:bg-blue-900/30"
              >
                <div className="flex items-center gap-2 w-full">
                  <Users className="h-4 w-4" />
                  <span>All campaigns</span>
                </div>
              </DropdownMenuCheckboxItem>
              {campaignsForFilter.map((campaign) => {
                const isSelected = selectedCampaignFilters.includes(campaign._id)
                return (
                  <DropdownMenuCheckboxItem
                    key={campaign._id}
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      console.log(`📊 Campaign ${campaign.name} ${checked ? 'SELECTED' : 'UNSELECTED'}`)
                      console.log('📊 Current filters before change:', selectedCampaignFilters)
                      if (checked) {
                        const newFilters = [...selectedCampaignFilters, campaign._id]
                        console.log('📊 New filters after selection:', newFilters)
                        setSelectedCampaignFilters(newFilters)
                      } else {
                        const newFilters = selectedCampaignFilters.filter(id => id !== campaign._id)
                        console.log('📊 New filters after unselection:', newFilters)
                        setSelectedCampaignFilters(newFilters)
                      }
                    }}
                    onSelect={(e) => e.preventDefault()}
                    className="hover:bg-accent focus:bg-accent"
                  >
                    <span className="truncate">
                      {campaign.name} ({campaign.sentMessages})
                    </span>
                  </DropdownMenuCheckboxItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {dateFilter === 'custom' && (
            <Button 
              variant="outline" 
              className="justify-start text-left font-normal"
              onClick={() => setShowDatePicker(true)}
            >
              <Calendar className="mr-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {dateRange.from.toLocaleDateString()} -{" "}
                    {dateRange.to.toLocaleDateString()}
                  </>
                ) : (
                  dateRange.from.toLocaleDateString()
                )
              ) : (
                <span>Pick a date range</span>
              )}
            </Button>
          )}

          {/* Simple date picker dialog for now */}
          <Dialog open={showDatePicker} onOpenChange={setShowDatePicker}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Select Date Range</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">From:</label>
                  <Input
                    type="date"
                    value={dateRange?.from?.toISOString().split('T')[0] || ''}
                    onChange={(e) => {
                      const date = e.target.value ? new Date(e.target.value) : undefined
                      setDateRange({ ...dateRange, from: date })
                    }}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">To:</label>
                  <Input
                    type="date"
                    value={dateRange?.to?.toISOString().split('T')[0] || ''}
                    onChange={(e) => {
                      const date = e.target.value ? new Date(e.target.value) : undefined
                      setDateRange({ ...dateRange, to: date })
                    }}
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setShowDatePicker(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setShowDatePicker(false)}>
                    Apply
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Conversation list */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {filteredAndSortedConversations.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No conversations found
          </div>
        ) : (
          <>
            {filteredAndSortedConversations.map((conversation, index) => (
              <ConversationRow
                key={`${conversation.normalizedPhoneNumber}-${index}`}
                conversation={conversation}
                isSelected={selectedConversation?.normalizedPhoneNumber === conversation.normalizedPhoneNumber}
                onClick={() => onSelectConversation(conversation)}
                isChecked={checkedConversations.has(conversation.normalizedPhoneNumber)}
                onCheckboxChange={(checked) => onCheckboxChange(conversation.normalizedPhoneNumber, checked)}
                onStarToggle={() => onStarToggle(conversation.normalizedPhoneNumber)}
              />
            ))}

            {/* Infinite scroll trigger and loading indicator */}
            {hasNextPage && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-2">
                {isFetchingNextPage ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <div className="animate-spin rounded-full h-3 w-3 border-b border-muted-foreground"></div>
                    Loading more...
                  </div>
                ) : (
                  <div className="h-8">{/* Invisible spacer to maintain scroll position */}</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MessengerInterface({
  conversation,
  allMessages = [],
  onClose
}: {
  conversation: Conversation
  allMessages?: Message[]
  onClose?: () => void
}) {
  const [activeTab, setActiveTab] = useState('messages')
  const [newMessage, setNewMessage] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState(conversation.deviceId)
  const [showDeviceChangeDialog, setShowDeviceChangeDialog] = useState(false)
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Fetch conversation metadata to get preferred device
  const { data: conversationMetadata } = useQuery({
    queryKey: ['conversation-metadata'],
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.users.getConversationMetadata())
        .then((res) => res.data),
  })

  // Fetch devices list
  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.listDevices())
        .then((res) => res.data),
  })

  // Update selectedDeviceId when conversation metadata loads
  useEffect(() => {
    if (conversationMetadata && conversation.normalizedPhoneNumber) {
      const metadata = conversationMetadata[conversation.normalizedPhoneNumber]
      if (metadata?.preferredDeviceId) {
        setSelectedDeviceId(metadata.preferredDeviceId)
      } else if (conversation.deviceId) {
        setSelectedDeviceId(conversation.deviceId)
      }
    }
  }, [conversationMetadata, conversation.normalizedPhoneNumber, conversation.deviceId])

  // Ensure we default to an enabled device when devices load
  useEffect(() => {
    if (devices?.data && selectedDeviceId) {
      const selectedDevice = devices.data.find((d: any) => d._id === selectedDeviceId)
      // If selected device is disabled or doesn't exist, switch to first enabled device
      if (!selectedDevice || !selectedDevice.enabled) {
        const firstEnabledDevice = devices.data.find((d: any) => d.enabled)
        if (firstEnabledDevice) {
          setSelectedDeviceId(firstEnabledDevice._id)
        }
      }
    } else if (devices?.data && !selectedDeviceId) {
      // If no device is selected, default to first enabled device
      const firstEnabledDevice = devices.data.find((d: any) => d.enabled)
      if (firstEnabledDevice) {
        setSelectedDeviceId(firstEnabledDevice._id)
      }
    }
  }, [devices?.data, selectedDeviceId])

  const updateDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await httpBrowserClient.patch(
        ApiEndpoints.users.updateConversationDevice(),
        {
          phoneNumber: conversation.normalizedPhoneNumber,
          deviceId: deviceId
        }
      )
      return response.data
    },
    onSuccess: () => {
      toast({
        title: "Device updated",
        description: "Future messages will be sent from the selected device."
      })
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update device",
        description: error.response?.data?.message || error.message || "An error occurred.",
        variant: "destructive"
      })
    }
  })

  const sendSmsMutation = useMutation({
    mutationFn: async (messageText: string) => {
      if (!selectedDeviceId) {
        throw new Error('No device available to send message')
      }

      // Validate that the selected device is enabled
      const selectedDevice = devices?.data?.find((d: any) => d._id === selectedDeviceId)
      if (!selectedDevice?.enabled) {
        throw new Error('Selected device is not enabled. Please enable the device or select a different one.')
      }

      const response = await httpBrowserClient.post(
        ApiEndpoints.gateway.sendSMS(selectedDeviceId),
        {
          deviceId: selectedDeviceId,
          recipients: [conversation.phoneNumber],
          message: messageText
        }
      )
      return response.data
    },
    onSuccess: () => {
      toast({
        title: "Message sent",
        description: "Your message has been sent successfully."
      })
      queryClient.invalidateQueries({ queryKey: ['all-messages'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
    },
    onError: (error: any) => {
      console.error('SMS send error:', error)
      console.error('Error response:', error.response?.data)
      console.error('Conversation deviceId:', conversation.deviceId)
      console.error('Phone number:', conversation.phoneNumber)

      // Extract error message - backend sends in .error field, not .message
      const errorMessage = error.response?.data?.error
        || error.response?.data?.message
        || error.message
        || "An error occurred while sending the message."

      toast({
        title: "Failed to send message",
        description: errorMessage,
        variant: "destructive"
      })
    }
  })

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }

  const displayName = conversation.contact?.firstName || conversation.contact?.lastName
    ? `${conversation.contact.firstName || ''} ${conversation.contact.lastName || ''}`.trim()
    : formatPhoneNumberDisplay(conversation.normalizedPhoneNumber)

  // Filter messages for this conversation
  const conversationMessages = useMemo(() => {
    return allMessages
      .filter(msg => {
        const messageSenderNormalized = msg.sender ? normalizePhoneNumber(msg.sender) : null
        const messageRecipientNormalized = msg.recipient ? normalizePhoneNumber(msg.recipient) : null

        return (
          messageSenderNormalized === conversation.normalizedPhoneNumber ||
          messageRecipientNormalized === conversation.normalizedPhoneNumber
        )
      })
      .sort((a, b) => {
        const dateA = new Date(a.receivedAt || a.requestedAt || 0)
        const dateB = new Date(b.receivedAt || b.requestedAt || 0)
        return dateA.getTime() - dateB.getTime()
      })
  }, [allMessages, conversation.normalizedPhoneNumber])

  // Scroll to bottom when conversation changes or new messages arrive
  useEffect(() => {
    scrollToBottom()
  }, [conversation.normalizedPhoneNumber])

  useEffect(() => {
    scrollToBottom()
  }, [conversationMessages.length])

  const handleSendMessage = () => {
    if (!newMessage.trim()) return
    sendSmsMutation.mutate(newMessage.trim())
    setNewMessage('')
  }

  const handleDeviceChange = (newDeviceId: string) => {
    if (newDeviceId === selectedDeviceId) return

    setPendingDeviceId(newDeviceId)
    setShowDeviceChangeDialog(true)
  }

  const confirmDeviceChange = () => {
    if (pendingDeviceId) {
      setSelectedDeviceId(pendingDeviceId)
      updateDeviceMutation.mutate(pendingDeviceId)
      setShowDeviceChangeDialog(false)
      setPendingDeviceId(null)
    }
  }

  const cancelDeviceChange = () => {
    setShowDeviceChangeDialog(false)
    setPendingDeviceId(null)
  }

  const selectedDevice = devices?.data?.find((d: any) => d._id === selectedDeviceId)
  const pendingDevice = devices?.data?.find((d: any) => d._id === pendingDeviceId)
  const selectedDevicePhone = selectedDevice?.phoneNumber || selectedDevice?.phoneNumber2
  const pendingDevicePhone = pendingDevice?.phoneNumber || pendingDevice?.phoneNumber2

  return (
    <div className="flex flex-col h-full border-l">
      {/* Header with Device Selector */}
      <div className="p-4 border-b">
        {/* Contact name and close button */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">{displayName}</h2>
            {conversation.contact?.firstName && (
              <p className="text-sm text-muted-foreground">{formatPhoneNumberDisplay(conversation.normalizedPhoneNumber)}</p>
            )}
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Device Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Sending from:</label>
          <Select
            value={selectedDeviceId || ''}
            onValueChange={handleDeviceChange}
            disabled={!devices?.data?.length}
          >
            <SelectTrigger className="w-full h-10">
              <SelectValue placeholder="Select a device" />
            </SelectTrigger>
            <SelectContent>
              {devices?.data?.map((device: any) => (
                <SelectItem
                  key={device._id}
                  value={device._id}
                  disabled={!device.enabled}
                  className="py-2"
                >
                  <div className={cn("flex flex-col", !device.enabled && "opacity-50")}>
                    <div className="flex items-center gap-2 font-medium">
                      <Smartphone className="h-4 w-4" />
                      <span>{device.brand} {device.model}</span>
                      {!device.enabled && <span className="text-xs">(disabled)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground ml-6 mt-0.5">
                      {formatPhoneNumberDisplay(device.phoneNumber)} • ID: {device._id}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Warning for disabled device */}
          {selectedDeviceId && devices?.data?.find((d: any) => d._id === selectedDeviceId && !d.enabled) && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded mt-2">
              ⚠️ The selected device is currently disabled. Please enable it or select a different device to send messages.
            </div>
          )}
        </div>
      </div>

      {/* Tabs - Messages, Info, Notes */}
      <div className="border-b">
        <div className="flex">
          <button 
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === 'messages' 
                ? "border-primary text-primary" 
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveTab('messages')}
          >
            Messages
          </button>
          <button 
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === 'info' 
                ? "border-primary text-primary" 
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveTab('info')}
          >
            Info
          </button>
          <button 
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === 'notes' 
                ? "border-primary text-primary" 
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveTab('notes')}
          >
            Notes
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'messages' && (
          <>
            {/* Messages area - takes remaining space and scrolls */}
            <div
              ref={messagesContainerRef}
              className="flex-1 min-h-0 overflow-y-auto bg-muted/20"
            >
              <div className="p-4">
                {conversationMessages.length === 0 ? (
                  <div className="text-center text-muted-foreground">
                    No messages found
                  </div>
                ) : (() => {
                  // Convert messages to the format expected by grouping function
                  const formattedMessages: MessageWithDate[] = conversationMessages.map((message, index) => ({
                    id: `${message._id}-${index}`,
                    message: message.message,
                    date: new Date(message.receivedAt || message.requestedAt || 0),
                    isIncoming: !!message.sender,
                    status: message.status as MessageStatus,
                    deviceId: typeof message.device === 'string' ? message.device : message.device?._id,
                    senderPhoneNumber: message.senderPhoneNumber,
                    originalMessage: message
                  }))

                  // Group messages with date and metadata change separators
                  const messageGroups = groupMessagesWithMetadataChanges(formattedMessages)

                  return messageGroups.map((group, index) => {
                    if (group.type === 'date') {
                      return (
                        <DateSeparator key={`date-${index}`} dateLabel={group.dateLabel!} />
                      )
                    } else if (group.type === 'metadata-change') {
                      return (
                        <MetadataChangeSeparator
                          key={`metadata-${index}`}
                          deviceId={group.changeInfo!.deviceId}
                          phoneNumber={group.changeInfo!.phoneNumber}
                        />
                      )
                    } else {
                      const msg = group.message!
                      return (
                        <div key={msg.id} className="mb-3">
                          <div className={cn(
                            "flex items-center gap-2",
                            msg.isIncoming ? "justify-start" : "justify-end"
                          )}>
                            {!msg.isIncoming && (
                              <div className="text-xs text-muted-foreground">
                                {formatMessageTime(msg.date)}
                              </div>
                            )}
                            <div className={cn(
                              "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                              msg.isIncoming
                                ? "bg-background border text-foreground"
                                : "bg-primary text-white"
                            )}>
                              <p className="break-words whitespace-pre-wrap">{msg.message}</p>
                            </div>
                            {msg.isIncoming && (
                              <div className="text-xs text-muted-foreground">
                                {formatMessageTime(msg.date)}
                              </div>
                            )}
                          </div>
                          {!msg.isIncoming && msg.status && (
                            <div className="flex justify-end mt-1">
                              <MessageStatusIndicator
                                status={msg.status}
                                isIncoming={msg.isIncoming}
                              />
                            </div>
                          )}
                        </div>
                      )
                    }
                  })
                })()}
              </div>
            </div>

            {/* Message input area - fixed at bottom */}
            <div className="flex-shrink-0 p-4 border-t bg-background">
              {(() => {
                const selectedDevice = devices?.data?.find((d: any) => d._id === selectedDeviceId)
                const isDeviceEnabled = selectedDevice?.enabled ?? false

                return (
                  <>
                    {!selectedDeviceId && (
                      <div className="text-sm text-yellow-600 bg-yellow-50 p-2 rounded mb-2">
                        No device available to send messages
                      </div>
                    )}
                    {selectedDeviceId && !isDeviceEnabled && (
                      <div className="text-sm text-red-600 bg-red-50 p-2 rounded mb-2">
                        Selected device is disabled. Enable it or select another device to send messages.
                      </div>
                    )}
                    <div className="flex space-x-2">
                      <Input
                        placeholder={
                          !selectedDeviceId
                            ? "No device available"
                            : !isDeviceEnabled
                            ? "Device is disabled"
                            : "Type a message..."
                        }
                        className="flex-1"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && isDeviceEnabled && newMessage.trim()) {
                            e.preventDefault()
                            handleSendMessage()
                          }
                        }}
                        disabled={!selectedDeviceId || !isDeviceEnabled}
                      />
                      <Button
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || sendSmsMutation.isPending || !selectedDeviceId || !isDeviceEnabled}
                      >
                        {sendSmsMutation.isPending ? 'Sending...' : 'Send'}
                      </Button>
                    </div>
                  </>
                )
              })()}
            </div>
          </>
        )}

        {activeTab === 'info' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ContactInfoEditor
              conversation={conversation}
              conversationMessages={conversationMessages}
              onContactUpdated={(updatedContact) => {
                // Force refresh of all related data
                queryClient.invalidateQueries({ queryKey: ['contacts-all'] })
                queryClient.invalidateQueries({ queryKey: ['all-messages'] })
                queryClient.invalidateQueries({ queryKey: ['devices'] })
              }}
            />
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="flex-1 p-4">
            <div className="space-y-4">
              <h3 className="font-semibold">Notes</h3>
              <p className="text-sm text-muted-foreground">
                Note-taking functionality will be implemented here.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Device Change Confirmation Dialog */}
      <AlertDialog open={showDeviceChangeDialog} onOpenChange={setShowDeviceChangeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Sending Device?</AlertDialogTitle>
            <AlertDialogDescription>
              Messages to <strong>{displayName}</strong> will now be sent from a different phone number.
              {selectedDevicePhone && pendingDevicePhone && (
                <>
                  {' '}You're switching from <strong>{formatPhoneNumberDisplay(selectedDevicePhone)}</strong> to <strong>{formatPhoneNumberDisplay(pendingDevicePhone)}</strong>.
                </>
              )}
              {' '}This could be confusing to your client who has been receiving messages from your current number. Are you sure you want to make this change?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDeviceChange}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeviceChange}>
              Yes, Change Device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ContactInfoEditor({
  conversation,
  conversationMessages,
  onContactUpdated
}: {
  conversation: Conversation
  conversationMessages: Message[]
  onContactUpdated: (contact: any) => void
}) {
  type EditableContact = Omit<NonNullable<typeof conversation.contact>, 'dncUpdatedAt'> & {
    dncUpdatedAt?: Date
  }

  const toEditableContact = (c: any | undefined | null): EditableContact | undefined => {
    if (!c) return undefined
    return {
      ...c,
      dncUpdatedAt: c.dncUpdatedAt ? new Date(c.dncUpdatedAt) : undefined,
    }
  }
  const [isEditing, setIsEditing] = useState(false)
    const [localContact, setLocalContact] = useState<EditableContact | undefined>(
      toEditableContact(conversation.contact)
  )
  const [editData, setEditData] = useState({
    firstName: localContact?.firstName || '',
    lastName: localContact?.lastName || '',
    email: localContact?.email || '',
    dnc: localContact?.dnc ?? null,
    propertyAddress: localContact?.propertyAddress || '',
    propertyCity: localContact?.propertyCity || '',
    propertyState: localContact?.propertyState || '',
    propertyZip: localContact?.propertyZip || '',
    parcelCounty: localContact?.parcelCounty || '',
    parcelState: localContact?.parcelState || '',
    parcelAcres: localContact?.parcelAcres || 0,
    apn: localContact?.apn || '',
    mailingAddress: localContact?.mailingAddress || '',
    mailingCity: localContact?.mailingCity || '',
    mailingState: localContact?.mailingState || '',
    mailingZip: localContact?.mailingZip || '',
  })

  // Fetch contact groups
  const { data: contactGroups = [] } = useQuery({
    queryKey: ['contact-groups', localContact?.id],
    queryFn: () => contactsApi.getContactGroups(localContact?.id),
    enabled: !!localContact?.id,
  })

  // Update local contact when conversation.contact changes
  useEffect(() => {
    setLocalContact(toEditableContact(conversation.contact))
  }, [conversation.contact])

  // Update edit data when localContact changes
  useEffect(() => {
    setEditData({
      firstName: localContact?.firstName || '',
      lastName: localContact?.lastName || '',
      email: localContact?.email || '',
      dnc: localContact?.dnc ?? null,
      propertyAddress: localContact?.propertyAddress || '',
      propertyCity: localContact?.propertyCity || '',
      propertyState: localContact?.propertyState || '',
      propertyZip: localContact?.propertyZip || '',
      parcelCounty: localContact?.parcelCounty || '',
      parcelState: localContact?.parcelState || '',
      parcelAcres: localContact?.parcelAcres || 0,
      apn: localContact?.apn || '',
      mailingAddress: localContact?.mailingAddress || '',
      mailingCity: localContact?.mailingCity || '',
      mailingState: localContact?.mailingState || '',
      mailingZip: localContact?.mailingZip || '',
    })
  }, [localContact])
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const updateContactMutation = useMutation({
    mutationFn: async (data: Partial<typeof editData>) => {
      // Clean up the data - convert empty strings to undefined for optional fields
      const cleanData = Object.fromEntries(
        Object.entries(data).map(([key, value]) => [
          key,
          value === '' ? undefined : value
        ])
      )

      if (localContact?.id) {
        // Update existing contact
        return contactsApi.updateContact(localContact.id, cleanData)
      } else {
        // Create new contact
        return contactsApi.createContact({
          phone: conversation.phoneNumber,
          ...cleanData
        })
      }
    },
    onSuccess: (updatedContact) => {
      toast({
        title: localContact?.id ? "Contact updated" : "Contact created",
        description: localContact?.id
          ? "Contact information has been saved successfully."
          : "Contact record has been created and saved successfully."
      })
      setIsEditing(false)
      // Update local contact state immediately
      setLocalContact(toEditableContact(updatedContact))
      onContactUpdated(updatedContact)
      queryClient.invalidateQueries({ queryKey: ['contacts-all'] })
      queryClient.invalidateQueries({ queryKey: ['all-messages'] })
    },
    onError: (error: any) => {
      toast({
        title: conversation.contact?.id ? "Failed to update contact" : "Failed to create contact",
        description: error.response?.data?.message || error.message || "An error occurred while saving the contact.",
        variant: "destructive"
      })
    }
  })

  const handleSave = () => {
    updateContactMutation.mutate(editData)
  }

  const handleCancel = () => {
    setEditData({
      firstName: localContact?.firstName || '',
      lastName: localContact?.lastName || '',
      email: localContact?.email || '',
      dnc: localContact?.dnc ?? null,
      propertyAddress: localContact?.propertyAddress || '',
      propertyCity: localContact?.propertyCity || '',
      propertyState: localContact?.propertyState || '',
      propertyZip: localContact?.propertyZip || '',
      parcelCounty: localContact?.parcelCounty || '',
      parcelState: localContact?.parcelState || '',
      parcelAcres: localContact?.parcelAcres || 0,
      apn: localContact?.apn || '',
      mailingAddress: localContact?.mailingAddress || '',
      mailingCity: localContact?.mailingCity || '',
      mailingState: localContact?.mailingState || '',
      mailingZip: localContact?.mailingZip || '',
    })
    setIsEditing(false)
  }

  const contactFields = [
    { key: 'firstName', label: 'First Name', type: 'text' },
    { key: 'lastName', label: 'Last Name', type: 'text' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'propertyAddress', label: 'Property Address', type: 'text' },
    { key: 'propertyCity', label: 'Property City', type: 'text' },
    { key: 'propertyState', label: 'Property State', type: 'text' },
    { key: 'propertyZip', label: 'Property Zip', type: 'text' },
    { key: 'parcelCounty', label: 'Parcel County', type: 'text' },
    { key: 'parcelState', label: 'Parcel State', type: 'text' },
    { key: 'parcelAcres', label: 'Parcel Acres', type: 'number' },
    { key: 'apn', label: 'APN', type: 'text' },
    { key: 'mailingAddress', label: 'Mailing Address', type: 'text' },
    { key: 'mailingCity', label: 'Mailing City', type: 'text' },
    { key: 'mailingState', label: 'Mailing State', type: 'text' },
    { key: 'mailingZip', label: 'Mailing Zip', type: 'text' },
  ]

  return (
    <div className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Contact Information</h3>
          {!isEditing ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="gap-2"
            >
              <Edit className="h-4 w-4" />
              {localContact?.id ? 'Edit' : 'Add Info'}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={updateContactMutation.isPending}
                className="gap-2"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updateContactMutation.isPending}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                {updateContactMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <span className="font-medium">Phone:</span> {conversation.normalizedPhoneNumber}
            </div>

            {/* DNC Information */}
            <div className="flex items-center gap-2">
              <span className="font-medium">Do Not Call:</span>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <select
                    value={editData.dnc === null ? 'unknown' : editData.dnc ? 'yes' : 'no'}
                    onChange={(e) => {
                      const value = e.target.value === 'unknown' ? null : e.target.value === 'yes'
                      setEditData(prev => ({ ...prev, dnc: value }))
                    }}
                    className="rounded border border-input px-2 py-1 text-sm"
                  >
                    <option value="unknown">Unknown</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              ) : (
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  localContact?.dnc === true
                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    : localContact?.dnc === false
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                }`}>
                  {localContact?.dnc === true ? 'Yes' : localContact?.dnc === false ? 'No' : 'Unknown'}
                </span>
              )}
            </div>

            {/* DNC Last Updated Date */}
            <div className="pl-4">
              <span className="text-xs text-muted-foreground">
                DNC Last Updated: {
                  localContact?.dncUpdatedAt
                    ? localContact.dncUpdatedAt.toLocaleDateString()
                    : 'Never'
                }
              </span>
            </div>

            {contactFields.map((field) => {
              const value = isEditing ? editData[field.key] : localContact?.[field.key]
              const displayValue = field.type === 'number' && value === 0 ? '' : value

              return (
                <div key={field.key}>
                  <span className="font-medium">{field.label}:</span>{' '}
                  {isEditing ? (
                    <Input
                      type={field.type}
                      value={displayValue || ''}
                      onChange={(e) => {
                        const newValue = field.type === 'number'
                          ? (e.target.value ? parseFloat(e.target.value) : 0)
                          : e.target.value
                        setEditData(prev => ({ ...prev, [field.key]: newValue }))
                      }}
                      className="mt-1"
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                    />
                  ) : (
                    <span className="text-muted-foreground">
                      {displayValue || '-'}
                    </span>
                  )}
                </div>
              )
            })}

            <div>
              <span className="font-medium">Total Messages:</span> {conversationMessages.length}
            </div>
            {conversationMessages.length > 0 && (
              <div>
                <span className="font-medium">First Contact:</span>{' '}
                {new Date(conversationMessages[0].receivedAt || conversationMessages[0].requestedAt || 0).toLocaleDateString()}
              </div>
            )}

            {/* Groups Information */}
            <div className="border-t pt-3 mt-3">
              <div className="text-sm">
                <span className="font-medium">Groups:</span>
                <ul className="list-disc list-inside ml-4 mt-1">
                  {contactGroups.length > 0 ? (
                    contactGroups.map((group, index) => (
                      <li key={index}>{group}</li>
                    ))
                  ) : (
                    <li className="text-muted-foreground">No groups</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {!localContact?.id && !isEditing && (
          <div className="text-sm text-muted-foreground bg-blue-50 p-3 rounded border border-blue-200">
            This contact doesn't have a database record yet. Click "Add Info" to create one and save contact details.
          </div>
        )}
      </div>
    </div>
  )
}

export default function InboxPage() {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [sortBy, setSortBy] = useState('newest')
  const [dateFilter, setDateFilter] = useState('all')
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date } | undefined>()
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewMessageSidebar, setShowNewMessageSidebar] = useState(false)
  const [newConversation, setNewConversation] = useState<Conversation | null>(null)
  const [autoRefreshInterval] = useState(15) // Default to 15 seconds
  const [lastSeenTimestamps, setLastSeenTimestamps] = useState<Record<string, Date>>({})
  const [selectedInboxFilter, setSelectedInboxFilter] = useState<'all' | 'unread' | 'unreplied' | 'awaiting-reply' | 'starred' | 'engaged'>('engaged')
  const [selectedCampaignFilters, setSelectedCampaignFilters] = useState<string[]>([])
  const [debouncedCampaignFilters, setDebouncedCampaignFilters] = useState<string[]>([])
  const [selectedOtherFilter, setSelectedOtherFilter] = useState<'archived' | 'spam' | null>(null)
  const [checkedConversations, setCheckedConversations] = useState<Set<string>>(new Set())
  const refreshTimerRef = useRef(null)

  // Debounce campaign filter updates to prevent dropdown from closing during rapid selections
  useEffect(() => {
    console.log('⏱️ Setting up debounce timer for:', selectedCampaignFilters)
    const timer = setTimeout(() => {
      console.log('🎯 DEBOUNCED UPDATE - Setting debouncedCampaignFilters to:', selectedCampaignFilters)
      setDebouncedCampaignFilters(selectedCampaignFilters)
    }, 500) // 500ms delay

    return () => {
      console.log('🚫 Clearing previous debounce timer')
      clearTimeout(timer)
    }
  }, [selectedCampaignFilters])

  // Debug: Log campaign filter changes
  useEffect(() => {
    console.log('🔄 selectedCampaignFilters changed:', selectedCampaignFilters)
    console.log('🔄 Filter count:', selectedCampaignFilters.length)
  }, [selectedCampaignFilters])

  // Debug: Log debounced campaign filter changes
  useEffect(() => {
    console.log('🎯 debouncedCampaignFilters changed:', debouncedCampaignFilters)
    console.log('🎯 Debounced filter count:', debouncedCampaignFilters.length)
  }, [debouncedCampaignFilters])
  const queryClient = useQueryClient()

  // Remove manual pagination state - now handled by useInfiniteQuery

  // Load conversation read statuses from API
  const { data: readStatuses } = useQuery({
    queryKey: ['conversation-read-statuses'],
    queryFn: async () => {
      const response = await httpBrowserClient.get(ApiEndpoints.users.getConversationReadStatuses())
      const statuses: Record<string, string> = response.data
      const timestamps: Record<string, Date> = {}
      Object.entries(statuses).forEach(([key, value]) => {
        timestamps[key] = new Date(value)
      })
      return timestamps
    }
  })

  // Load conversation metadata (archive/block/star status) from API
  const { data: conversationMetadata } = useQuery({
    queryKey: ['conversation-metadata'],
    queryFn: async () => {
      const response = await httpBrowserClient.get(ApiEndpoints.users.getConversationMetadata())
      return response.data as Record<string, { isArchived: boolean; isBlocked: boolean; isStarred: boolean; archivedAt?: Date }>
    }
  })

  // Update local state when API data is loaded
  useEffect(() => {
    if (readStatuses) {
      setLastSeenTimestamps(readStatuses)
    }
  }, [readStatuses])

  // Query devices - still needed for message interface
  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.listDevices())
        .then((res) => res.data),
  })

  // Query contacts for name resolution - still needed for new message sidebar
  const { data: contactsData } = useQuery({
    queryKey: ['contacts-all'],
    queryFn: () => contactsApi.getContacts({ limit: 1000 }),
  })

  // Query conversations with infinite scroll
  const {
    data: conversationsData,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch
  } = useInfiniteQuery<ConversationsResponse, Error>({
    queryKey: ['conversations', selectedInboxFilter, selectedOtherFilter, debouncedCampaignFilters, sortBy],
    initialPageParam: 1,
    queryFn: async ({ pageParam = 1 }) => {
      console.log('🚀 API CALL TRIGGERED - queryFn executing')
      console.log('🚀 Page param:', pageParam)
      console.log('🚀 Current debouncedCampaignFilters:', debouncedCampaignFilters)

      const filterValue = selectedOtherFilter || selectedInboxFilter
      const params = new URLSearchParams({
        page: pageParam.toString(),
        limit: '9',
        sortBy,
        filter: filterValue
      })

      // Add campaign filters if selected (OR logic - conversations from any of the selected campaigns)
      if (debouncedCampaignFilters.length > 0) {
        // Send as comma-separated values for OR logic
        params.append('campaignIds', debouncedCampaignFilters.join(','))
        console.log('🚀 Added campaignIds to params:', debouncedCampaignFilters.join(','))
      }

      const url = `${ApiEndpoints.users.getConversations()}?${params}`
      console.log('🚀 Final API URL:', url)

      const response = await httpBrowserClient.get(url)
      console.log('🚀 API RESPONSE received')
      return response.data as ConversationsResponse
    },
    getNextPageParam: (lastPage) => {
      return lastPage.meta.hasNextPage ? lastPage.meta.currentPage + 1 : undefined
    },
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchOnMount: false, // Prevent refetch on mount to avoid scroll jumps
    refetchOnWindowFocus: false, // Prevent refetch on focus to avoid scroll jumps
  })  

  // Debug: Log query states
  useEffect(() => {
    console.log('⚡ Query states - isLoading:', isLoading, 'isFetching:', isFetching, 'isFetchingNextPage:', isFetchingNextPage)
  }, [isLoading, isFetching, isFetchingNextPage])

  // Query messages from all devices (for message interface when conversation is selected)
  const { data: messagesData } = useQuery({
    queryKey: ['all-messages'],
    enabled: !!devices?.data?.length && !!selectedConversation,
    queryFn: async () => {
      if (!devices?.data?.length) return []

      const allMessages: Message[] = []

      // Fetch messages from all devices
      for (const device of devices.data) {
        try {
          const response = await httpBrowserClient.get(
            `${ApiEndpoints.gateway.getMessages(device._id)}?type=all&limit=1000`
          )
          if (response.data?.data) {
            allMessages.push(...response.data.data)
          }
        } catch (error) {
          console.error(`Failed to fetch messages for device ${device._id}:`, error)
        }
      }

      return allMessages
    },
  })

  // Setup auto-refresh timer - only refresh first page to avoid scroll disruption
  useEffect(() => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    // Set up timer for 15 second auto-refresh
    if (devices?.data?.length) {
      refreshTimerRef.current = setInterval(() => {
        // Only invalidate conversation counts and metadata, not the full conversation list
        // This prevents scroll jumps while still updating sidebar counts
        queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
        queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
        queryClient.invalidateQueries({ queryKey: ['conversation-read-statuses'] })
      }, autoRefreshInterval * 1000)
    }

    // Cleanup on unmount
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
      }
    }
  }, [autoRefreshInterval, devices?.data?.length, queryClient])

  // Process conversations from infinite query pages
  const conversations = useMemo(() => {
    if (!conversationsData?.pages) return []

    // Flatten all pages and convert date strings back to Date objects
    const allConversations = conversationsData.pages.flatMap(page =>
      page.data.map(conv => ({ // Property 'data' does not exist on type 'unknown'.ts(2339)
        ...conv,
        lastMessageDate: new Date(conv.lastMessageDate),
        lastMessage: {
          ...conv.lastMessage,
          timestamp: new Date(conv.lastMessage.timestamp)
        },
        archivedAt: conv.archivedAt ? new Date(conv.archivedAt) : undefined,
        contact: conv.contact ? {
          ...conv.contact,
          dncUpdatedAt: conv.contact.dncUpdatedAt ? new Date(conv.contact.dncUpdatedAt) : undefined
        } : undefined
      }))
    )

    // Add new conversation if it exists and isn't already in the list
    if (newConversation && !allConversations.find(conv => conv.normalizedPhoneNumber === newConversation.normalizedPhoneNumber)) {
      return [newConversation, ...allConversations]
    }

    return allConversations
  }, [conversationsData?.pages, newConversation])

  // Get conversation counts from dedicated endpoint
  const { data: conversationCounts = { all: 0, unread: 0, unreplied: 0, awaitingReply: 0, starred: 0, archived: 0, spam: 0 } } = useQuery({
    queryKey: ['conversation-counts'],
    queryFn: async () => {
      const response = await httpBrowserClient.get(ApiEndpoints.users.getConversationCounts())
      return response.data
    },
  })

  // Get campaigns for filter dropdown
  const { data: campaignsForFilter = [] } = useQuery({
    queryKey: ['campaigns-for-filter'],
    queryFn: async () => {
      const response = await campaignsApi.getSidebarCampaigns(1, 100) // Get more campaigns for dropdown
      return response.campaigns
    },
    staleTime: 60000, // Consider data fresh for 1 minute
  })


  // Conversations are now filtered by the backend, so we just use them directly
  const filteredConversations = conversations

  // Load more conversations function
  const loadMoreConversations = async () => {
    if (!hasNextPage || isFetchingNextPage) return

    try {
      await fetchNextPage()
    } catch (error) {
      console.error('Failed to load more conversations:', error)
    }
  }

  // No need to reset pagination manually - useInfiniteQuery handles this automatically when queryKey changes

  // Function to mark a conversation as seen
  const markConversationAsSeen = async (conversation: Conversation) => {
    const now = new Date()

    // Update local state immediately for responsive UI
    setLastSeenTimestamps(prev => ({
      ...prev,
      [conversation.normalizedPhoneNumber]: now
    }))
    setSelectedConversation(conversation)
    setShowNewMessageSidebar(false)

    // Save to database
    try {
      await httpBrowserClient.post(ApiEndpoints.users.markConversationAsRead(), {
        normalizedPhoneNumber: conversation.normalizedPhoneNumber,
        lastSeenAt: now.toISOString()
      })
      // Invalidate queries to refresh from server and update UI immediately
      queryClient.invalidateQueries({ queryKey: ['conversation-read-statuses'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
    } catch (error) {
      console.error('Failed to mark conversation as read:', error)
    }
  }

  // Checkbox and action handlers
  const handleCheckboxChange = (phoneNumber: string, checked: boolean) => {
    setCheckedConversations(prev => {
      const newSet = new Set(prev)
      if (checked) {
        newSet.add(phoneNumber)
      } else {
        newSet.delete(phoneNumber)
      }
      return newSet
    })
  }

  const handleStarToggle = async (phoneNumber: string) => {
    try {
      const currentMetadata = conversationMetadata?.[phoneNumber]
      const newStarredState = !currentMetadata?.isStarred

      // Optimistic update
      queryClient.setQueryData(['conversation-metadata'], (oldData: any) => {
        if (!oldData) return oldData

        const newData = { ...oldData }
        newData[phoneNumber] = {
          ...newData[phoneNumber],
          isStarred: newStarredState,
          starredAt: newStarredState ? new Date() : null
        }
        return newData
      })

      await httpBrowserClient.patch(ApiEndpoints.users.toggleConversationStar(), {
        phoneNumber,
        isStarred: newStarredState
      })

      // Invalidate and refetch metadata
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (error) {
      console.error('Failed to toggle star:', error)
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  }

  const handleArchiveConversations = async () => {
    try {
      const phoneNumbersToArchive = Array.from(checkedConversations)

      // Optimistic update
      queryClient.setQueryData(['conversation-metadata'], (oldData: any) => {
        if (!oldData) return oldData

        const newData = { ...oldData }
        phoneNumbersToArchive.forEach(phoneNumber => {
          newData[phoneNumber] = {
            ...newData[phoneNumber],
            isArchived: true,
            archivedAt: new Date()
          }
        })
        return newData
      })

      await httpBrowserClient.post(ApiEndpoints.users.archiveConversations(), {
        phoneNumbers: phoneNumbersToArchive
      })

      setCheckedConversations(new Set())
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (error) {
      console.error('Failed to archive conversations:', error)
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  }

  const handleBlockContacts = async () => {
    try {
      const phoneNumbersToBlock = Array.from(checkedConversations)

      // Optimistic update - immediately update the query cache
      queryClient.setQueryData(['conversation-metadata'], (oldData: any) => {
        if (!oldData) return oldData

        const newData = { ...oldData }
        phoneNumbersToBlock.forEach(phoneNumber => {
          newData[phoneNumber] = {
            ...newData[phoneNumber],
            isBlocked: true,
            isArchived: false, // Remove from archived when blocking
            blockedAt: new Date(),
            archivedAt: null
          }
        })
        return newData
      })

      await httpBrowserClient.post(ApiEndpoints.users.blockContacts(), {
        phoneNumbers: phoneNumbersToBlock
      })

      setCheckedConversations(new Set())

      // Invalidate to ensure we get fresh data from server
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (error) {
      console.error('Failed to block contacts:', error)
      // Revert optimistic update on error
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  }

  const handleUnarchiveConversations = async () => {
    try {
      const phoneNumbersToUnarchive = Array.from(checkedConversations)

      // Optimistic update
      queryClient.setQueryData(['conversation-metadata'], (oldData: any) => {
        if (!oldData) return oldData

        const newData = { ...oldData }
        phoneNumbersToUnarchive.forEach(phoneNumber => {
          newData[phoneNumber] = {
            ...newData[phoneNumber],
            isArchived: false,
            archivedAt: null
          }
        })
        return newData
      })

      await httpBrowserClient.post(ApiEndpoints.users.unarchiveConversations(), {
        phoneNumbers: phoneNumbersToUnarchive
      })

      setCheckedConversations(new Set())
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (error) {
      console.error('Failed to unarchive conversations:', error)
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  }

  const handleUnblockContacts = async () => {
    try {
      const phoneNumbersToUnblock = Array.from(checkedConversations)

      // Optimistic update
      queryClient.setQueryData(['conversation-metadata'], (oldData: any) => {
        if (!oldData) return oldData

        const newData = { ...oldData }
        phoneNumbersToUnblock.forEach(phoneNumber => {
          newData[phoneNumber] = {
            ...newData[phoneNumber],
            isBlocked: false,
            blockedAt: null
          }
        })
        return newData
      })

      await httpBrowserClient.post(ApiEndpoints.users.unblockContacts(), {
        phoneNumbers: phoneNumbersToUnblock
      })

      setCheckedConversations(new Set())
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (error) {
      console.error('Failed to unblock contacts:', error)
      queryClient.invalidateQueries({ queryKey: ['conversation-metadata'] })
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  }

  // Get current view for determining which actions to show
  const getCurrentView = () => {
    if (selectedOtherFilter) {
      return selectedOtherFilter
    }
    return 'inbox'
  }

  if (isLoading) {
    return (
      <div className='flex h-full overflow-hidden'>
        {/* Sidebar */}
        <div className='w-64 border-r bg-background/50 flex flex-col h-full overflow-hidden'>
          <div className='p-4 pb-2 flex-shrink-0'>
            {/* Fixed header area */}
          </div>
          <div className='flex-1 overflow-y-auto px-4 pb-4'>
            <div className='space-y-2'>
              <Skeleton className="h-6 w-20 mb-4" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-6 w-24 mt-6 mb-2" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex h-full overflow-hidden">
          <div className="w-1/2 border-r">
            <div className="p-4 space-y-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-10 w-full" />
              <div className="flex space-x-2">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-32" />
              </div>
            </div>
            <div className="space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="p-4 border-b">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-3 w-48" />
                </div>
              ))}
            </div>
          </div>
          <div className="w-1/2">
            <div className="p-4">
              <Skeleton className="h-6 w-32" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full overflow-hidden'>
      {/* Sidebar */}
      <div className='w-64 border-r bg-background/50 flex flex-col h-full overflow-hidden'>
        <div className='p-4 pb-2 flex-shrink-0'>
          {/* Fixed header area can go here if needed */}
        </div>
        <div className='flex-1 overflow-y-auto px-4 pb-4'>
          <div className='space-y-2'>
          {/* Inbox Section */}
          <div className="space-y-1">
            <div className="flex items-center text-sm font-medium text-muted-foreground mb-2">
              <InboxIcon className="mr-2 h-4 w-4" />
              Inbox
            </div>
            <Button
              variant={selectedInboxFilter === 'engaged' && !selectedOtherFilter ? 'default' : 'ghost'}
              className='w-full justify-between text-sm'
              onClick={() => {
                setSelectedInboxFilter('engaged')
                setSelectedOtherFilter(null)
              }}
            >
              <div className="flex items-center">
                <Users className='mr-2 h-4 w-4' />
                Two-Way
              </div>
              <span className="text-xs opacity-70">({conversationCounts.engaged})</span>
            </Button>
            <Button
              variant={selectedInboxFilter === 'all' && !selectedOtherFilter ? 'default' : 'ghost'}
              className='w-full justify-between text-sm'
              onClick={() => {
                setSelectedInboxFilter('all')
                setSelectedOtherFilter(null)
              }}
            >
              <div className="flex items-center">
                <Mail className='mr-2 h-4 w-4' />
                All
              </div>
              <span className="text-xs opacity-70">({conversationCounts.all})</span>
            </Button>
            <Button
              variant={selectedInboxFilter === 'unread' && !selectedOtherFilter ? 'default' : 'ghost'}
              className='w-full justify-between text-sm'
              onClick={() => {
                setSelectedInboxFilter('unread')
                setSelectedOtherFilter(null)
              }}
            >
              <div className="flex items-center">
                <MailOpen className='mr-2 h-4 w-4' />
                Unread
              </div>
              <span className="text-xs opacity-70">({conversationCounts.unread})</span>
            </Button>
            <Button
              variant={selectedInboxFilter === 'unreplied' && !selectedOtherFilter ? 'default' : 'ghost'}
              className='w-full justify-between text-sm'
              onClick={() => {
                setSelectedInboxFilter('unreplied')
                setSelectedOtherFilter(null)
              }}
            >
              <div className="flex items-center">
                <MessageCircle className='mr-2 h-4 w-4' />
                Unreplied
              </div>
              <span className="text-xs opacity-70">({conversationCounts.unreplied})</span>
            </Button>
            <Button
              variant={selectedInboxFilter === 'awaiting-reply' && !selectedOtherFilter ? 'default' : 'ghost'}
              className='w-full justify-between text-sm'
              onClick={() => {
                setSelectedInboxFilter('awaiting-reply')
                setSelectedOtherFilter(null)
              }}
            >
              <div className="flex items-center">
                <Clock className='mr-2 h-4 w-4' />
                Awaiting reply
              </div>
              <span className="text-xs opacity-70">({conversationCounts.awaitingReply})</span>
            </Button>
            <Button
              variant={selectedInboxFilter === 'starred' && !selectedOtherFilter ? 'default' : 'ghost'}
              className='w-full justify-between text-sm'
              onClick={() => {
                setSelectedInboxFilter('starred')
                setSelectedOtherFilter(null)
              }}
            >
              <div className="flex items-center">
                <Star className='mr-2 h-4 w-4' />
                Starred
              </div>
              <span className="text-xs opacity-70">({conversationCounts.starred})</span>
            </Button>
          </div>


          {/* Other Section */}
          <div className="space-y-1 pt-4">
            <div className="flex items-center text-sm font-medium text-muted-foreground mb-2">
              <Archive className="mr-2 h-4 w-4" />
              Other
            </div>
            <Button
              variant={selectedOtherFilter === 'archived' ? 'default' : 'ghost'}
              className='w-full justify-between text-sm'
              onClick={() => {
                setSelectedOtherFilter('archived')
                setSelectedInboxFilter('all')
              }}
            >
              <div className="flex items-center">
                <Archive className='mr-2 h-4 w-4' />
                Archived
              </div>
              <span className="text-xs opacity-70">({conversationCounts.archived})</span>
            </Button>
            <Button
              variant={selectedOtherFilter === 'spam' ? 'default' : 'ghost'}
              className='w-full justify-between text-sm'
              onClick={() => {
                setSelectedOtherFilter('spam')
                setSelectedInboxFilter('all')
              }}
            >
              <div className="flex items-center">
                <Trash2 className='mr-2 h-4 w-4' />
                Spam
              </div>
              <span className="text-xs opacity-70">({conversationCounts.spam})</span>
            </Button>
          </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex h-full overflow-hidden">
        {/* Conversation list panel */}
        <div className={selectedConversation || showNewMessageSidebar ? "w-1/2" : "w-full"}>
          <ConversationList
            conversations={filteredConversations}
            selectedConversation={selectedConversation}
            onSelectConversation={markConversationAsSeen}
            sortBy={sortBy}
            setSortBy={setSortBy}
            dateFilter={dateFilter}
            setDateFilter={setDateFilter}
            dateRange={dateRange}
            setDateRange={setDateRange}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onNewMessage={() => setShowNewMessageSidebar(true)}
            checkedConversations={checkedConversations}
            onCheckboxChange={handleCheckboxChange}
            onStarToggle={handleStarToggle}
            onArchiveConversations={handleArchiveConversations}
            onBlockContacts={handleBlockContacts}
            onUnarchiveConversations={handleUnarchiveConversations}
            onUnblockContacts={handleUnblockContacts}
            currentView={getCurrentView()}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            isFetching={isFetching}
            onLoadMore={loadMoreConversations}
            campaignsForFilter={campaignsForFilter}
            selectedCampaignFilters={selectedCampaignFilters}
            setSelectedCampaignFilters={setSelectedCampaignFilters}
          />
        </div>

        {/* Messenger interface panel */}
        {selectedConversation && !showNewMessageSidebar && (
          <div className="w-1/2">
            <MessengerInterface
              conversation={selectedConversation}
              allMessages={messagesData || []}
              onClose={() => setSelectedConversation(null)}
            />
          </div>
        )}

        {/* New Message Sidebar */}
        {showNewMessageSidebar && (
          <div className="w-1/2">
            <NewMessageSidebar
              onClose={() => setShowNewMessageSidebar(false)}
              onConversationCreated={(conversation) => {
                setNewConversation(conversation)
                setSelectedConversation(conversation)
                setShowNewMessageSidebar(false)
              }}
              allMessages={messagesData || []}
              contacts={contactsData?.data || []}
              devices={devices?.data || []}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function NewMessageSidebar({
  onClose,
  onConversationCreated,
  allMessages,
  contacts,
  devices
}: {
  onClose: () => void
  onConversationCreated: (conversation: Conversation) => void
  allMessages: Message[]
  contacts: any[]
  devices: any[]
}) {
  const [searchInput, setSearchInput] = useState('')
  const [selectedContact, setSelectedContact] = useState<any>(null)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [message, setMessage] = useState('')
  const [filteredContacts, setFilteredContacts] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [hasSelectedRecipient, setHasSelectedRecipient] = useState(false)
  const [selectedContactChip, setSelectedContactChip] = useState<any>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [showDeviceChangeDialog, setShowDeviceChangeDialog] = useState(false)
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null)
  const { toast } = useToast()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const contactRefs = useRef<(HTMLDivElement | null)[]>([])

  // Initialize device selection with first enabled device
  useEffect(() => {
    if (devices && devices.length > 0) {
      const enabledDevice = devices.find(d => d.enabled)
      if (enabledDevice && !selectedDeviceId) {
        setSelectedDeviceId(enabledDevice._id)
      }
    }
  }, [devices, selectedDeviceId])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentConversation])

  // Get messages for current conversation
  const conversationMessages = useMemo(() => {
    if (!currentConversation) return []

    return allMessages
      .filter(msg => {
        const messageSenderNormalized = msg.sender ? normalizePhoneNumber(msg.sender) : null
        const messageRecipientNormalized = msg.recipient ? normalizePhoneNumber(msg.recipient) : null

        return (
          messageSenderNormalized === currentConversation.normalizedPhoneNumber ||
          messageRecipientNormalized === currentConversation.normalizedPhoneNumber
        )
      })
      .sort((a, b) => {
        const dateA = new Date(a.receivedAt || a.requestedAt || 0)
        const dateB = new Date(b.receivedAt || b.requestedAt || 0)
        return dateA.getTime() - dateB.getTime()
      })
  }, [allMessages, currentConversation])

  // Filter contacts based on search input
  useEffect(() => {
    if (searchInput.trim() === '') {
      setFilteredContacts([])
      setShowSuggestions(false)
      return
    }

    const filtered = contacts.filter(contact => {
      const searchLower = searchInput.toLowerCase()
      const firstName = contact.firstName?.toLowerCase() || ''
      const lastName = contact.lastName?.toLowerCase() || ''
      const phone = contact.phone || ''

      return firstName.includes(searchLower) ||
             lastName.includes(searchLower) ||
             phone.includes(searchInput) ||
             normalizePhoneNumber(phone).includes(searchInput)
    }).slice(0, 5) // Limit to 5 suggestions

    setFilteredContacts(filtered)
    setShowSuggestions(true)
  }, [searchInput, contacts])

  // Reset highlighted index when filtered contacts change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [filteredContacts])

  // Scroll highlighted item into view
  useEffect(() => {
    if (contactRefs.current[highlightedIndex]) {
      contactRefs.current[highlightedIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [highlightedIndex])

  // Handle contact selection
  const handleContactSelect = (contact: any) => {
    setSelectedContact(contact)
    setSelectedContactChip(contact)
    setPhoneNumber(contact.phone)
    setSearchInput('')
    setShowSuggestions(false)
    setHasSelectedRecipient(true)

    // Create conversation with existing messages
    const conversation = createConversation(contact.phone, contact)
    setCurrentConversation(conversation)
  }

  // Handle manual phone number input
  const handleSearchInputChange = (value: string) => {
    setSearchInput(value)

    // Clear previous state if not selecting from contacts
    if (!selectedContact && !selectedContactChip) {
      setCurrentConversation(null)
      setPhoneNumber('')
      setHasSelectedRecipient(false)
    }
  }

  // Validate phone number format
  const isValidPhoneNumber = (phoneStr: string) => {
    const cleanInput = phoneStr.replace(/\D/g, '')
    return cleanInput.length >= 10
  }

  // Handle phone number confirmation (called when user presses Enter or starts typing message)
  const confirmPhoneNumberInput = () => {
    if (!searchInput || selectedContact || selectedContactChip) return

    if (isValidPhoneNumber(searchInput)) {
      setPhoneNumber(searchInput)
      setHasSelectedRecipient(true)
      setShowSuggestions(false)

      // Try to find matching contact by phone number
      const normalizedInput = normalizePhoneNumber(searchInput)
      const matchingContact = contacts.find(c =>
        c.phone === searchInput ||
        c.phone === normalizedInput ||
        normalizePhoneNumber(c.phone) === normalizedInput
      )

      if (matchingContact) {
        // If we found a matching contact, set it as selected
        setSelectedContact(matchingContact)
        setSelectedContactChip(matchingContact)
      }

      // Create conversation for phone number with matched contact (if any)
      const conversation = createConversation(searchInput, matchingContact)
      setCurrentConversation(conversation)
    }
  }

  // Handle key presses for keyboard navigation and selection
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filteredContacts.length > 0) {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleContactSelect(filteredContacts[highlightedIndex])
      } else if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          // Navigate up with Shift+Tab
          setHighlightedIndex(prev => prev > 0 ? prev - 1 : filteredContacts.length - 1)
        } else {
          // Navigate down with Tab
          setHighlightedIndex(prev => prev < filteredContacts.length - 1 ? prev + 1 : 0)
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedIndex(prev => prev < filteredContacts.length - 1 ? prev + 1 : 0)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : filteredContacts.length - 1)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      confirmPhoneNumberInput()
    }

    if (e.key === 'Backspace' && searchInput === '' && selectedContactChip) {
      // Delete the selected contact chip
      setSelectedContactChip(null)
      setSelectedContact(null)
      setPhoneNumber('')
      setCurrentConversation(null)
      setHasSelectedRecipient(false)
    }
  }

  // Clear selection function
  const clearSelection = () => {
    setSelectedContactChip(null)
    setSelectedContact(null)
    setPhoneNumber('')
    setCurrentConversation(null)
    setHasSelectedRecipient(false)
    setSearchInput('')
  }

  // Create conversation from contact or phone number
  const createConversation = (targetPhone: string, contact?: any): Conversation => {
    const normalizedPhone = normalizePhoneNumber(targetPhone)

    const existingMessages = allMessages.filter(msg => {
      const msgSender = msg.sender ? normalizePhoneNumber(msg.sender) : null
      const msgRecipient = msg.recipient ? normalizePhoneNumber(msg.recipient) : null
      return msgSender === normalizedPhone || msgRecipient === normalizedPhone
    })

    const sorted = existingMessages.sort((a, b) => {
      const aDate = new Date(a.receivedAt || a.requestedAt || 0)
      const bDate = new Date(b.receivedAt || b.requestedAt || 0)
      return bDate.getTime() - aDate.getTime()
    })

    const lastMessage = sorted[0]
    const deviceId = devices[0]?._id || ''

    return {
      phoneNumber: targetPhone,
      normalizedPhoneNumber: normalizedPhone,
      deviceId,
      contact,
      lastMessage: lastMessage
        ? {
            message: lastMessage.message,
            timestamp: new Date(lastMessage.receivedAt || lastMessage.requestedAt || new Date()),
            isIncoming: !!lastMessage.sender,
          }
        : { message: '', timestamp: new Date(), isIncoming: false },
      lastMessageDate: lastMessage
        ? new Date(lastMessage.receivedAt || lastMessage.requestedAt || new Date())
        : new Date(),
      messageCount: existingMessages.length,
      unseenCount: 0,          // 👈 required by ConversationSummary
      isStarred: false,
    }
  }

  // Device change handlers
  const handleDeviceChange = (newDeviceId: string) => {
    if (newDeviceId === selectedDeviceId) return

    setPendingDeviceId(newDeviceId)
    setShowDeviceChangeDialog(true)
  }

  const confirmDeviceChange = () => {
    if (pendingDeviceId) {
      setSelectedDeviceId(pendingDeviceId)
      setShowDeviceChangeDialog(false)
      setPendingDeviceId(null)
    }
  }

  const cancelDeviceChange = () => {
    setShowDeviceChangeDialog(false)
    setPendingDeviceId(null)
  }

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ phone, messageText }: { phone: string, messageText: string }) => {
      const enabledDevice = devices.find(d => d._id === selectedDeviceId && d.enabled)
      if (!enabledDevice) {
        throw new Error('No enabled device available to send message')
      }

      const response = await httpBrowserClient.post(
        ApiEndpoints.gateway.sendSMS(enabledDevice._id),
        {
          deviceId: enabledDevice._id,
          recipients: [phone],
          message: messageText
        }
      )
      return response.data
    },
    onSuccess: () => {
      toast({
        title: "Message sent",
        description: "Your message has been sent successfully."
      })

      // Create and return the conversation (use current conversation if available)
      const conversation = currentConversation || createConversation(phoneNumber, selectedContact)
      onConversationCreated(conversation)

      // Reset message and close sidebar after successful send
      setMessage('')
      onClose()
    },
    onError: (error: any) => {
      toast({
        title: "Failed to send message",
        description: error.response?.data?.message || error.message || "An error occurred while sending the message.",
        variant: "destructive"
      })
    }
  })

  const handleSendMessage = () => {
    if (!currentConversation || !message.trim()) {
      toast({
        title: "Missing information",
        description: "Please select a contact and enter a message.",
        variant: "destructive"
      })
      return
    }

    sendMessageMutation.mutate({ phone: currentConversation.phoneNumber, messageText: message })
  }


  const displayName = currentConversation?.contact?.firstName || currentConversation?.contact?.lastName
    ? `${currentConversation.contact.firstName || ''} ${currentConversation.contact.lastName || ''}`.trim()
    : currentConversation?.normalizedPhoneNumber ? formatPhoneNumberDisplay(currentConversation.normalizedPhoneNumber) : 'New Message'


  const enabledDevice = devices.find(d => d._id === selectedDeviceId && d.enabled)

  return (
    <div className="flex flex-col h-full border-l overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{displayName}</h2>
          {currentConversation?.contact?.firstName && (
            <p className="text-sm text-muted-foreground">{formatPhoneNumberDisplay(currentConversation.normalizedPhoneNumber)}</p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Recipient Selection */}
      <div className="p-4 border-b">
        <div className="relative">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap">To:</label>

            {/* Selected Contact Chip or Input */}
            <div className="flex flex-wrap gap-2 min-h-[40px] flex-1 items-center border border-gray-200 dark:border-gray-700 rounded-md p-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
            {selectedContactChip && (
              <div className="inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full text-sm border border-blue-200 dark:border-blue-700">
                <span>
                  {selectedContactChip.firstName || selectedContactChip.lastName
                    ? `${selectedContactChip.firstName || ''} ${selectedContactChip.lastName || ''}`.trim()
                    : selectedContactChip.phone
                  }
                </span>
                <button
                  onClick={clearSelection}
                  className="ml-1 hover:bg-blue-200 rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {phoneNumber && !selectedContactChip && (
              <div className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded-full text-sm border border-gray-200 dark:border-gray-600">
                <span>{formatPhoneNumberDisplay(phoneNumber)}</span>
                <button
                  onClick={clearSelection}
                  className="ml-1 hover:bg-gray-200 rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {!selectedContactChip && !phoneNumber && (
              <Input
                placeholder="Enter phone number, first name, or last name"
                value={searchInput}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                onFocus={() => {if (filteredContacts.length > 0) setShowSuggestions(true)}}
                className="border-0 focus:ring-0 flex-1 pl-2 pr-2 py-1 min-w-0"
              />
            )}
            </div>
          </div>

          {/* Contact Suggestions */}
          {showSuggestions && filteredContacts.length > 0 && !selectedContactChip && (
            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
              {filteredContacts.map((contact, index) => (
                <div
                  key={contact.id}
                  ref={(el) => (contactRefs.current[index] = el)}
                  className={cn(
                    "p-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b last:border-b-0",
                    index === highlightedIndex && "bg-blue-50 dark:bg-blue-900/20"
                  )}
                  onClick={() => handleContactSelect(contact)}
                >
                  <div className="font-medium">
                    {contact.firstName || contact.lastName
                      ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
                      : contact.phone
                    }
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">{contact.phone}</div>
                  {index === highlightedIndex && (
                    <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">Press Enter to select</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Device Selector */}
      <div className="p-4 border-b">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Sending from:</label>
          <Select
            value={selectedDeviceId || ''}
            onValueChange={handleDeviceChange}
            disabled={!devices?.length}
          >
            <SelectTrigger className="w-full h-10">
              <SelectValue placeholder="Select a device" />
            </SelectTrigger>
            <SelectContent>
              {devices?.map((device: any) => (
                <SelectItem
                  key={device._id}
                  value={device._id}
                  disabled={!device.enabled}
                  className="py-2"
                >
                  <div className={cn("flex flex-col", !device.enabled && "opacity-50")}>
                    <div className="flex items-center gap-2 font-medium">
                      <Smartphone className="h-4 w-4" />
                      <span>{device.brand} {device.model}</span>
                      {!device.enabled && <span className="text-xs">(disabled)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground ml-6 mt-0.5">
                      {formatPhoneNumberDisplay(device.phoneNumber)} • ID: {device._id}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-muted/20">
        {currentConversation ? (
          <div className="p-4">
            {conversationMessages?.length === 0 ? (
              <div className="text-center text-muted-foreground">
                No messages yet. Start the conversation!
              </div>
            ) : (() => {
              // Convert messages to the format expected by grouping function
              const formattedMessages: MessageWithDate[] = conversationMessages?.map((message, index) => ({
                id: `${message._id}-${index}`,
                message: message.message,
                date: new Date(message.receivedAt || message.requestedAt || 0),
                isIncoming: !!message.sender,
                status: message.status as MessageStatus,
                deviceId: typeof message.device === 'string' ? message.device : message.device?._id,
                senderPhoneNumber: message.senderPhoneNumber,
                originalMessage: message
              })) || []

              // Group messages with date and metadata change separators
              const messageGroups = groupMessagesWithMetadataChanges(formattedMessages)

              return (
                <>
                  {messageGroups.map((group, index) => {
                    if (group.type === 'date') {
                      return (
                        <DateSeparator key={`date-${index}`} dateLabel={group.dateLabel!} />
                      )
                    } else if (group.type === 'metadata-change') {
                      return (
                        <MetadataChangeSeparator
                          key={`metadata-${index}`}
                          deviceId={group.changeInfo!.deviceId}
                          phoneNumber={group.changeInfo!.phoneNumber}
                        />
                      )
                    } else {
                      const msg = group.message!
                      return (
                        <div key={msg.id} className="mb-3">
                          <div className={cn(
                            "flex items-center gap-2",
                            msg.isIncoming ? "justify-start" : "justify-end"
                          )}>
                            {!msg.isIncoming && (
                              <div className="text-xs text-muted-foreground">
                                {formatMessageTime(msg.date)}
                              </div>
                            )}
                            <div className={cn(
                              "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                              msg.isIncoming
                                ? "bg-background border text-foreground"
                                : "bg-primary text-white"
                            )}>
                              <p className="break-words whitespace-pre-wrap">{msg.message}</p>
                            </div>
                            {msg.isIncoming && (
                              <div className="text-xs text-muted-foreground">
                                {formatMessageTime(msg.date)}
                              </div>
                            )}
                          </div>
                          {!msg.isIncoming && msg.status && (
                            <div className="flex justify-end mt-1">
                              <MessageStatusIndicator
                                status={msg.status}
                                isIncoming={msg.isIncoming}
                              />
                            </div>
                          )}
                        </div>
                      )
                    }
                  })}
                  <div ref={messagesEndRef} />
                </>
              )
            })()}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-center p-8">
            <div>
              <MessageSquarePlus className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium mb-2">Start a new conversation</p>
              <p className="text-sm">Enter a phone number or search for a contact above</p>
            </div>
          </div>
        )}
      </div>

      {/* Message Input */}
      <div className="flex-shrink-0 p-4 border-t bg-background">
        {!enabledDevice && (
          <div className="mb-2 text-sm text-yellow-600 bg-yellow-50 p-2 rounded">
            No enabled device available to send messages
          </div>
        )}
        <div className="flex space-x-2">
          <Input
            placeholder={enabledDevice ? "Type a message..." : "No device available"}
            className="flex-1"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onFocus={confirmPhoneNumberInput}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && enabledDevice && message.trim() && hasSelectedRecipient) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            disabled={!enabledDevice}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!message.trim() || sendMessageMutation.isPending || !enabledDevice || !hasSelectedRecipient || (currentConversation && !isValidPhoneNumber(currentConversation?.phoneNumber || ''))}
          >
            {sendMessageMutation.isPending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </div>

      {/* Device Change Confirmation Dialog */}
      <AlertDialog open={showDeviceChangeDialog} onOpenChange={setShowDeviceChangeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change sending device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will change the device used to send messages in this conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDeviceChange}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeviceChange}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}