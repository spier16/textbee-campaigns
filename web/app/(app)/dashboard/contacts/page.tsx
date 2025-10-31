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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Upload,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Users,
  FileSpreadsheet,
  ChevronUp,
  ChevronDown,
  Edit,
  Save,
  X,
  MessageSquare,
  Plus,
  RefreshCw,
  Eye,
  UserPlus,
  Smartphone,
} from 'lucide-react'
import { contactsApi, ContactSpreadsheet, Contact, downloadBlob, CreateGroupData } from '@/lib/api/contacts'
import { ApiEndpoints } from '@/config/api'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { cn, normalizePhoneNumber, formatMessageTime, groupMessagesWithDateSeparators, groupMessagesWithMetadataChanges, MessageWithDate, MessageGroup, getStatusDisplay, MessageStatus, formatPhoneNumberDisplay } from '@/lib/utils'
import CsvPreviewDialog from './(components)/csv-preview-dialog'
import ProcessingDetailsDialog from './(components)/processing-details-dialog'

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

function ContactSidebar({
  contact,
  onClose
}: {
  contact: Contact
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState('info')
  const [newMessage, setNewMessage] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [showDeviceChangeDialog, setShowDeviceChangeDialog] = useState(false)
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null)
  const [autoRefreshInterval] = useState(15) // Default to 15 seconds
  const refreshTimerRef = useRef(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Fetch contact groups
  const { data: contactGroups = [] } = useQuery({
    queryKey: ['contact-groups', contact.id],
    queryFn: () => contactsApi.getContactGroups(contact.id),
    enabled: !!contact.id,
  })

  // Fetch conversation metadata to get preferred device
  const { data: conversationMetadata } = useQuery({
    queryKey: ['conversation-metadata'],
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.users.getConversationMetadata())
        .then((res) => res.data),
  })

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.listDevices())
        .then((res) => res.data),
  })

  // Initialize selected device from metadata or default to first enabled device
  useEffect(() => {
    if (devices?.data?.length) {
      const normalizedPhone = normalizePhoneNumber(contact.phone)
      const metadata = conversationMetadata?.[normalizedPhone]

      if (metadata?.preferredDeviceId) {
        setSelectedDeviceId(metadata.preferredDeviceId)
      } else if (!selectedDeviceId) {
        const enabledDevice = devices.data.find((d: any) => d.enabled)
        if (enabledDevice) {
          setSelectedDeviceId(enabledDevice._id)
        }
      }
    }
  }, [devices, conversationMetadata, contact.phone, selectedDeviceId])

  const { data: messagesData, refetch } = useQuery({
    queryKey: ['contact-messages', contact.phone],
    enabled: !!devices?.data?.length,
    queryFn: async () => {
      if (!devices?.data?.length) return []

      const allMessages: Message[] = []
      const normalizedContactPhone = normalizePhoneNumber(contact.phone)

      for (const device of devices.data) {
        try {
          const response = await httpBrowserClient.get(
            `${ApiEndpoints.gateway.getMessages(device._id)}?type=all&limit=1000`
          )
          if (response.data?.data) {
            const contactMessages = response.data.data.filter((msg: Message) => {
              const messageSenderNormalized = msg.sender ? normalizePhoneNumber(msg.sender) : null
              const messageRecipientNormalized = msg.recipient ? normalizePhoneNumber(msg.recipient) : null

              return (
                messageSenderNormalized === normalizedContactPhone ||
                messageRecipientNormalized === normalizedContactPhone
              )
            })
            allMessages.push(...contactMessages)
          }
        } catch (error) {
          console.error(`Failed to fetch messages for device ${device._id}:`, error)
        }
      }

      return allMessages.sort((a, b) => {
        const dateA = new Date(a.receivedAt || a.requestedAt || 0)
        const dateB = new Date(b.receivedAt || b.requestedAt || 0)
        return dateA.getTime() - dateB.getTime()
      })
    },
  })

  // Setup auto-refresh timer
  useEffect(() => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    // Set up timer for 15 second auto-refresh
    if (devices?.data?.length) {
      refreshTimerRef.current = setInterval(() => {
        refetch()
      }, autoRefreshInterval * 1000)
    }

    // Cleanup on unmount
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
      }
    }
  }, [autoRefreshInterval, devices?.data?.length, refetch, contact.phone])

  // Mark conversation as read when messages tab is viewed
  const markConversationAsRead = useCallback(async () => {
    try {
      const normalizedPhoneNumber = normalizePhoneNumber(contact.phone)
      await httpBrowserClient.post(ApiEndpoints.users.markConversationAsRead(), {
        normalizedPhoneNumber,
        lastSeenAt: new Date().toISOString()
      })
      queryClient.invalidateQueries({ queryKey: ['conversation-read-statuses'] })
    } catch (error) {
      console.error('Failed to mark conversation as read:', error)
    }
  }, [contact.phone, queryClient])

  // Scroll to bottom when messages tab is active and messages are loaded
  useEffect(() => {
    if (activeTab === 'messages' && messagesData && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [activeTab, messagesData])

  // Mark conversation as read when messages tab is viewed
  useEffect(() => {
    if (activeTab === 'messages' && messagesData) {
      markConversationAsRead()
    }
  }, [activeTab, messagesData, markConversationAsRead])

  const updateDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await httpBrowserClient.patch(
        ApiEndpoints.users.updateConversationDevice(),
        {
          phoneNumber: normalizePhoneNumber(contact.phone),
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

      const response = await httpBrowserClient.post(
        ApiEndpoints.gateway.sendSMS(selectedDeviceId),
        {
          deviceId: selectedDeviceId,
          recipients: [contact.phone],
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
      queryClient.invalidateQueries({ queryKey: ['contact-messages', contact.phone] })
      // Scroll to bottom after sending message
      setTimeout(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
      }, 100)
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
  const enabledDevice = devices?.data?.find((d: any) => d._id === selectedDeviceId && d.enabled)

  const displayName = contact.firstName || contact.lastName
    ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
    : contact.phone

  return (
    <div className="flex flex-col h-full border-l overflow-hidden">
      {/* Header with Device Selector */}
      <div className="p-4 border-b">
        {/* Contact name and close button */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">{displayName}</h2>
            {contact.firstName && (
              <p className="text-sm text-muted-foreground">{contact.phone}</p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
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
        </div>
      </div>

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
            <MessageSquare className="h-4 w-4 mr-2 inline" />
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

      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'messages' && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto bg-muted/20">
              <div className="p-4">
                {messagesData?.length === 0 ? (
                  <div className="text-center text-muted-foreground">
                    No messages found
                  </div>
                ) : (() => {
                  // Convert messages to the format expected by grouping function
                  const formattedMessages: MessageWithDate[] = messagesData?.map((message, index) => ({
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
                                  <p>{msg.message}</p>
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
            </div>

            <div className="flex-shrink-0 p-4 border-t bg-background">
              {!enabledDevice && (
                <div className="text-sm text-yellow-600 bg-yellow-50 p-2 rounded mb-2">
                  No enabled device available to send messages
                </div>
              )}
              <div className="flex space-x-2">
                <Input
                  placeholder={enabledDevice ? "Type a message..." : "No device available"}
                  className="flex-1"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && enabledDevice && newMessage.trim()) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  disabled={!enabledDevice}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || sendSmsMutation.isPending || !enabledDevice}
                >
                  {sendSmsMutation.isPending ? 'Sending...' : 'Send'}
                </Button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'info' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ContactInfoEditor
              contact={contact}
              conversationMessages={messagesData || []}
              contactGroups={contactGroups}
              onContactUpdated={() => {
                queryClient.invalidateQueries({ queryKey: ['contacts-all'] })
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
  contact,
  conversationMessages = [],
  contactGroups = [],
  onContactUpdated
}: {
  contact: Contact
  conversationMessages?: Message[]
  contactGroups?: string[]
  onContactUpdated: (contact: any) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [localContact, setLocalContact] = useState(contact)
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

  useEffect(() => {
    setLocalContact(contact)
  }, [contact])

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
      const cleanData = Object.fromEntries(
        Object.entries(data).map(([key, value]) => [
          key,
          value === '' ? undefined : value
        ])
      )

      return contactsApi.updateContact(localContact.id, cleanData)
    },
    onSuccess: (updatedContact) => {
      toast({
        title: "Contact updated",
        description: "Contact information has been saved successfully."
      })
      setIsEditing(false)
      setLocalContact(updatedContact)
      onContactUpdated(updatedContact)
      queryClient.invalidateQueries({ queryKey: ['contacts-all'] })
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update contact",
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
              Edit
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
              <span className="font-medium">Phone:</span> {contact.phone}
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
                    ? new Date(localContact.dncUpdatedAt).toLocaleDateString()
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

            {conversationMessages.length > 0 && (
              <>
                <div>
                  <span className="font-medium">Total Messages:</span> {conversationMessages.length}
                </div>
                <div>
                  <span className="font-medium">First Contact:</span>{' '}
                  {new Date(conversationMessages[0].receivedAt || conversationMessages[0].requestedAt || 0).toLocaleDateString()}
                </div>
              </>
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
      </div>
    </div>
  )
}

export default function ContactsPage() {
  const [selectedMode, setSelectedMode] = useState<'spreadsheets' | 'all'>('spreadsheets')
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [displayCount, setDisplayCount] = useState(25)
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'a-z' | 'z-a'>('newest')
  const [spreadsheetSortBy, setSpreadsheetSortBy] = useState<'newest' | 'oldest' | 'a-z' | 'z-a' | 'status'>('newest')
  const [spreadsheetSortOrder, setSpreadsheetSortOrder] = useState<'asc' | 'desc'>('desc')
  const [contactSortBy, setContactSortBy] = useState<'firstName' | 'lastName' | 'phone' | 'email'>('firstName')
  const [contactSortOrder, setContactSortOrder] = useState<'asc' | 'desc'>('asc')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [createContactOpen, setCreateContactOpen] = useState(false)
  const [createContactData, setCreateContactData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    dnc: null as boolean | null,
    propertyAddress: '',
    propertyCity: '',
    propertyState: '',
    propertyZip: '',
    parcelCounty: '',
    parcelState: '',
    parcelAcres: 0,
    apn: '',
    mailingAddress: '',
    mailingCity: '',
    mailingState: '',
    mailingZip: '',
  })

  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [createGroupData, setCreateGroupData] = useState({
    name: '',
    description: '',
    selectedContacts: [] as string[],
  })
  const [availableContacts, setAvailableContacts] = useState<Contact[]>([])
  const [loadingAvailableContacts, setLoadingAvailableContacts] = useState(false)
  const [contactSearchQuery, setContactSearchQuery] = useState('')
  const [contactListHeight, setContactListHeight] = useState(400)
  const [currentContactPage, setCurrentContactPage] = useState(1)
  const [hasMoreContacts, setHasMoreContacts] = useState(true)
  const [totalAvailableContacts, setTotalAvailableContacts] = useState(0)
  const [loadingMoreContacts, setLoadingMoreContacts] = useState(false)
  const [searchDebounceTimer, setSearchDebounceTimer] = useState<NodeJS.Timeout | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const contactListRef = useRef<HTMLDivElement>(null)

  const [files, setFiles] = useState<ContactSpreadsheet[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [isLoadingContacts, setIsLoadingContacts] = useState(false)
  const [previewDialog, setPreviewDialog] = useState<{
    open: boolean
    spreadsheetId: string
    fileName: string
    fileContent: string
  }>({
    open: false,
    spreadsheetId: '',
    fileName: '',
    fileContent: '',
  })

  const [detailsDialog, setDetailsDialog] = useState<{
    open: boolean
    spreadsheet: ContactSpreadsheet | null
  }>({
    open: false,
    spreadsheet: null,
  })
  const { toast } = useToast()
  const queryClient = useQueryClient()


  // Load data on component mount and when parameters change
  useEffect(() => {
    if (selectedMode === 'spreadsheets') {
      loadSpreadsheets()
    } else {
      // Add small delay to prevent rate limiting on rapid sort changes
      const timer = setTimeout(() => {
        loadContacts()
      }, 200)
      
      return () => clearTimeout(timer)
    }
  }, [selectedMode, searchQuery, sortBy, spreadsheetSortBy, spreadsheetSortOrder, contactSortBy, contactSortOrder, displayCount, currentPage])

  const loadSpreadsheets = async () => {
    try {
      setLoading(true)
      const response = await contactsApi.getSpreadsheets({
        search: searchQuery || undefined,
        sortBy,  // Error here: Type '"newest" | "oldest" | "a-z" | "z-a" | "status"' is not assignable to type '"newest" | "oldest" | "a-z" | "z-a"'.
//   Type '"status"' is not assignable to type '"newest" | "oldest" | "a-z" | "z-a"'.ts(2322)
// contacts.ts(27, 3): The expected type comes from property 'sortBy' which is declared here on type 'GetSpreadsheetsParams'
// (property) GetSpreadsheetsParams.sortBy?: "newest" | "oldest" | "a-z" | "z-a"
        limit: displayCount,
        page: currentPage,
      })
      setFiles(response.data)
    } catch (error) {
      console.error('Error loading spreadsheets:', error)
      toast({
        title: 'Error',
        description: 'Failed to load contact spreadsheets',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const loadContacts = async () => {
    if (isLoadingContacts) return // Prevent concurrent requests
    
    try {
      setIsLoadingContacts(true)
      setLoading(true)
      
      const response = await contactsApi.getContacts({
        search: searchQuery || undefined,
        sortBy: contactSortBy,
        sortOrder: contactSortOrder,
        limit: displayCount,
        page: currentPage,
      })

      setContacts(response.data)
      setFilteredContactsTotal(response.total)
    } catch (error) {
      console.error('Error loading contacts:', error)
      toast({
        title: 'Error',
        description: 'Failed to load contacts',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
      setIsLoadingContacts(false)
    }
  }

  // Normalize phone number by removing all non-digits
  const normalizePhoneForSearch = useCallback((phone: string): string => {
    return phone.replace(/\D/g, '')
  }, [])

  // Flexible search function for contacts
  const searchContacts = useCallback((contacts: Contact[], query: string): Contact[] => {
    if (!query.trim()) return contacts

    const searchTerms = query.toLowerCase()
      .replace(/,/g, ' ') // Replace commas with spaces
      .split(/\s+/) // Split by whitespace
      .filter(term => term.length > 0)

    return contacts.filter(contact => {
      // Create searchable strings for the contact
      const firstName = (contact.firstName || '').toLowerCase()
      const lastName = (contact.lastName || '').toLowerCase()
      const fullName = `${firstName} ${lastName}`.trim()
      const reversedName = `${lastName} ${firstName}`.trim()
      const phone = contact.phone
      const normalizedPhone = normalizePhoneForSearch(phone)

      // For each search term, check if it matches any part of the contact
      return searchTerms.every(term => {
        // Check if term is likely a phone number (contains only digits)
        const isPhoneSearch = /^\d+$/.test(term)

        if (isPhoneSearch) {
          // For phone searches, check if the normalized phone contains the term
          return normalizedPhone.includes(term)
        } else {
          // For name searches, check various combinations
          return (
            firstName.includes(term) ||
            lastName.includes(term) ||
            fullName.includes(term) ||
            reversedName.includes(term) ||
            phone.includes(term) // Also check original phone format
          )
        }
      })
    })
  }, [normalizePhoneForSearch])

  // Use files/contacts directly since API handles filtering and sorting for most cases
  // But apply client-side sorting for Status column since it's not handled by backend
  const filteredAndSortedFiles = useMemo(() => {
    if (spreadsheetSortBy === 'status') {
      const sorted = [...files].sort((a, b) => {
        const statusOrder = { pending: 0, processed: 1 }
        const aOrder = statusOrder[a.status as keyof typeof statusOrder] ?? 2
        const bOrder = statusOrder[b.status as keyof typeof statusOrder] ?? 2

        if (spreadsheetSortOrder === 'asc') {
          return aOrder - bOrder
        } else {
          return bOrder - aOrder
        }
      })
      return sorted
    }
    return files
  }, [files, spreadsheetSortBy, spreadsheetSortOrder])

  // Note: Contact filtering is now handled server-side in loadContactPage()

  const filteredAndSortedContacts = useMemo(() => {
    // The API handles all sorting now
    return contacts
  }, [contacts])

  const [totalContacts, setTotalContacts] = useState(0)
  const [totalFiles, setTotalFiles] = useState(0)
  const [filteredContactsTotal, setFilteredContactsTotal] = useState(0)

  // Load stats separately
  useEffect(() => {
    loadStats()
  }, [])

  // Calculate dynamic height for contact list
  useEffect(() => {
    const calculateHeight = () => {
      const viewportHeight = window.innerHeight
      // Account for dialog header, form fields, search, buttons, and padding
      // Roughly: 60px header + 120px form fields + 80px search section + 80px footer + 60px padding
      const reservedHeight = 400
      const calculatedHeight = Math.max(300, viewportHeight - reservedHeight)
      setContactListHeight(calculatedHeight)
    }

    calculateHeight()
    window.addEventListener('resize', calculateHeight)
    return () => window.removeEventListener('resize', calculateHeight)
  }, [])

  // Handle initial load and search separately
  useEffect(() => {
    if (!createGroupOpen) return

    console.log('Search Change Event:', {
      newQuery: contactSearchQuery,
      isClearing: contactSearchQuery === '',
      dialogOpen: createGroupOpen,
      hasExistingTimer: !!searchDebounceTimer,
      currentContactCount: availableContacts.length,
      totalAvailable: totalAvailableContacts
    })

    // Clear existing timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      setSearchDebounceTimer(null)
      console.log('Cleared existing search timer')
    }

    if (contactSearchQuery === '') {
      // Initial load - no debouncing needed, load immediately
      console.log('Loading initial page (no search)')
      setIsSearching(true)
      loadContactPage(1, true, '').finally(() => setIsSearching(false))
    } else {
      // Search with debouncing
      console.log('Setting up search debounce timer (300ms)')
      setIsSearching(true)
      const timer = setTimeout(() => {
        console.log('Debounce timer fired, loading search results for:', contactSearchQuery)
        loadContactPage(1, true, contactSearchQuery).finally(() => setIsSearching(false))
      }, 300)
      setSearchDebounceTimer(timer)

      // Cleanup
      return () => {
        clearTimeout(timer)
        setIsSearching(false)
        console.log('Search useEffect cleanup - timer cleared, search state reset')
      }
    }
  }, [contactSearchQuery, createGroupOpen])

  // Cleanup when dialog closes
  useEffect(() => {
    if (!createGroupOpen) {
      // Clear any pending timers
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
        setSearchDebounceTimer(null)
      }
      // Reset contact-related state
      setAvailableContacts([])
      setContactSearchQuery('')
      setCurrentContactPage(1)
      setHasMoreContacts(true)
      setTotalAvailableContacts(0)
      setLoadingAvailableContacts(false)
      setLoadingMoreContacts(false)
      setIsSearching(false)
    }
  }, [createGroupOpen])

  const loadStats = async () => {
    try {
      const stats = await contactsApi.getStats()
      setTotalContacts(stats.totalContacts)
      setTotalFiles(stats.totalSpreadsheets)
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  const createContactMutation = useMutation({
    mutationFn: async (data: typeof createContactData) => {
      const { phone, dnc, ...rest } = data
      // convert '' -> undefined for optional fields
      const cleanedRest = Object.fromEntries(
        Object.entries(rest).map(([k, v]) => [k, v === '' ? undefined : v])
      ) as Partial<Contact>

      // Build a typed payload with required phone
      const payload: Partial<Contact> & { phone: string } = {
        phone: phone.trim(),
        ...cleanedRest,
        // normalize null to undefined for boolean field
        dnc: dnc ?? undefined,
      }
      return contactsApi.createContact(payload)
    },
    onSuccess: (newContact) => {
      toast({
        title: "Contact created",
        description: "New contact has been created successfully."
      })
      setCreateContactOpen(false)
      setCreateContactData({
        firstName: '',
        lastName: '',
        phone: '',
        email: '',
        dnc: null,
        propertyAddress: '',
        propertyCity: '',
        propertyState: '',
        propertyZip: '',
        parcelCounty: '',
        parcelState: '',
        parcelAcres: 0,
        apn: '',
        mailingAddress: '',
        mailingCity: '',
        mailingState: '',
        mailingZip: '',
      })
      // Refresh contacts list and stats
      if (selectedMode === 'all') {
        loadContacts()
      }
      loadStats()
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create contact",
        description: error.response?.data?.message || error.message || "An error occurred while creating the contact.",
        variant: "destructive"
      })
    }
  })

  const handleCreateContact = () => {
    if (!createContactData.phone.trim()) {
      toast({
        title: "Phone number required",
        description: "Please enter a phone number for the contact.",
        variant: "destructive"
      })
      return
    }
    createContactMutation.mutate(createContactData)
  }

  const createGroupMutation = useMutation({
    mutationFn: async (data: CreateGroupData) => {
      return contactsApi.createGroup(data)
    },
    onSuccess: (newGroup) => {
      toast({
        title: "Group created",
        description: "New contact group has been created successfully."
      })
      setCreateGroupOpen(false)
      setCreateGroupData({
        name: '',
        description: '',
        selectedContacts: [],
      })
      // Refresh spreadsheets list and stats
      if (selectedMode === 'spreadsheets') {
        loadSpreadsheets()
      }
      loadStats()
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create group",
        description: error.response?.data?.message || error.message || "An error occurred while creating the group.",
        variant: "destructive"
      })
    }
  })

  const handleCreateGroup = () => {
    if (!createGroupData.name.trim()) {
      toast({
        title: "Group name required",
        description: "Please enter a name for the group.",
        variant: "destructive"
      })
      return
    }
    if (createGroupData.selectedContacts.length === 0) {
      toast({
        title: "No contacts selected",
        description: "Please select at least one contact for the group.",
        variant: "destructive"
      })
      return
    }
    createGroupMutation.mutate({
      name: createGroupData.name,
      description: createGroupData.description || undefined,
      contactIds: createGroupData.selectedContacts,
    })
  }

  const loadContactPage = async (page: number, reset: boolean = false, searchQuery: string = '') => {
    if (reset) {
      setLoadingAvailableContacts(true)
      setAvailableContacts([])
      setCurrentContactPage(1)
      setHasMoreContacts(true)
    } else {
      setLoadingMoreContacts(true)
    }

    try {
      const response = await contactsApi.getContacts({
        limit: 25,
        page: page,
        sortBy: 'firstName',
        sortOrder: 'asc',
        search: searchQuery || undefined,
      })

      if (reset) {
        setAvailableContacts(response.data)
      } else {
        setAvailableContacts(prev => [...prev, ...response.data])
      }

      setTotalAvailableContacts(response.total)
      setCurrentContactPage(page)
      const hasMore = response.data.length === 25 && (page * 25) < response.total
      setHasMoreContacts(hasMore)

      // Debug logging for pagination state
      console.log('Pagination Debug:', {
        page,
        reset,
        searchQuery,
        responseDataLength: response.data.length,
        total: response.total,
        currentItems: page * 25,
        hasMoreContacts: hasMore,
        loadedSoFar: reset ? response.data.length : availableContacts.length + response.data.length
      })
    } catch (error) {
      console.error('Error loading available contacts:', error)
      toast({
        title: 'Error',
        description: 'Failed to load contacts for group selection',
        variant: 'destructive',
      })
    } finally {
      setLoadingAvailableContacts(false)
      setLoadingMoreContacts(false)
    }
  }

  const loadAvailableContacts = async () => {
    console.log('🚀 loadAvailableContacts called - Dialog opening, resetting state')
    // Reset all state when opening dialog - let useEffect handle the loading
    setContactSearchQuery('')
    setCurrentContactPage(1)
    setHasMoreContacts(true)
    setTotalAvailableContacts(0)
    setLoadingMoreContacts(false)
    setIsSearching(false)
    // Removed: await loadContactPage(1, true) - this was causing race condition
    // The useEffect will trigger when contactSearchQuery changes to ''
    console.log('🚀 State reset complete, useEffect will trigger loading')
  }

  const handleContactListScroll = useCallback(() => {
    const scrollState = {
      hasRef: !!contactListRef.current,
      loadingMoreContacts,
      hasMoreContacts,
      isSearching,
      currentPage: currentContactPage,
      searchQuery: contactSearchQuery || '(no search)'
    }

    if (!contactListRef.current || loadingMoreContacts || !hasMoreContacts || isSearching) {
      if (isSearching) {
        console.log('Scroll Event - Ignored (search in progress):', scrollState)
      } else {
        console.log('Scroll Event - Early Return:', scrollState)
      }
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = contactListRef.current

    // Handle case where content is shorter than container (no scrolling needed)
    const hasScrollableContent = scrollHeight > clientHeight
    const threshold = 50
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold

    const detailedScrollState = {
      ...scrollState,
      scrollTop,
      scrollHeight,
      clientHeight,
      hasScrollableContent,
      distanceFromBottom: scrollHeight - scrollTop - clientHeight,
      threshold,
      isNearBottom,
      isAtTop: scrollTop === 0,
      isAtBottom: scrollTop + clientHeight >= scrollHeight - 5
    }

    console.log('Scroll Event Details:', detailedScrollState)

    if (!hasScrollableContent) {
      console.log('No scrollable content - returning')
      return
    }

    if (isNearBottom) {
      console.log('🔄 Infinite Scroll Triggered!', {
        nextPage: currentContactPage + 1,
        currentContacts: availableContacts.length,
        totalContacts: totalAvailableContacts,
        threshold,
        distanceFromBottom: scrollHeight - scrollTop - clientHeight
      })
      loadContactPage(currentContactPage + 1, false, contactSearchQuery)
    }
  }, [currentContactPage, hasMoreContacts, loadingMoreContacts, contactSearchQuery, isSearching])

  // Add scroll listener for infinite scroll
  useEffect(() => {
    const listElement = contactListRef.current
    if (!listElement) return

    listElement.addEventListener('scroll', handleContactListScroll)
    return () => {
      listElement.removeEventListener('scroll', handleContactListScroll)
    }
  }, [handleContactListScroll])

  // Reset scroll position when search changes (including clearing search)
  useEffect(() => {
    if (contactListRef.current) {
      // Always reset scroll on search changes, with small delay to ensure content loads
      const timer = setTimeout(() => {
        if (contactListRef.current) {
          const wasScrolled = contactListRef.current.scrollTop > 0
          contactListRef.current.scrollTop = 0
          console.log('Scroll Reset:', {
            searchQuery: contactSearchQuery || '(empty)',
            wasScrolled,
            newScrollTop: 0,
            reason: 'search change'
          })
        }
      }, 50) // Small delay to ensure content has loaded

      return () => clearTimeout(timer)
    }
  }, [contactSearchQuery])

  // Monitor content height changes for debugging
  useEffect(() => {
    if (contactListRef.current) {
      const observer = new ResizeObserver(() => {
        if (contactListRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = contactListRef.current
          console.log('📏 Content Height Changed:', {
            scrollTop,
            scrollHeight,
            clientHeight,
            isAtBottom: scrollTop + clientHeight >= scrollHeight - 10,
            isAtTop: scrollTop === 0,
            contactCount: availableContacts.length,
            searchQuery: contactSearchQuery || '(no search)',
            hasMoreContacts
          })
        }
      })

      observer.observe(contactListRef.current)
      console.log('📏 Content height observer attached')

      return () => {
        observer.disconnect()
        console.log('📏 Content height observer disconnected')
      }
    }
  }, [availableContacts.length, contactSearchQuery, hasMoreContacts])

  const handleToggleContactInGroup = (contactId: string, checked: boolean) => {
    setCreateGroupData(prev => ({
      ...prev,
      selectedContacts: checked
        ? [...prev.selectedContacts, contactId]
        : prev.selectedContacts.filter(id => id !== contactId)
    }))
  }

  const deleteContactsMutation = useMutation({
    mutationFn: async (contactIds: string[]) => {
      if (contactIds.length === 1) {
        return contactsApi.deleteContact(contactIds[0])
      } else {
        return contactsApi.deleteMultipleContacts(contactIds)
      }
    },
    onSuccess: () => {
      const contactCount = selectedContacts.length
      const contactText = contactCount === 1 ? 'contact' : 'contacts'

      toast({
        title: "Success",
        description: `Deleted ${contactCount} ${contactText} successfully`
      })

      // Clear selection and reload data
      setSelectedContacts([])
      loadContacts()
      loadStats()
    },
    onError: (error: any) => {
      toast({
        title: "Delete failed",
        description: error.response?.data?.message || error.message || "Failed to delete contacts",
        variant: "destructive"
      })
    }
  })

  const handleDeleteSelectedContacts = async () => {
    if (selectedContacts.length === 0) return

    const contactCount = selectedContacts.length
    const contactText = contactCount === 1 ? 'contact' : 'contacts'

    if (!confirm(`Are you sure you want to permanently delete ${contactCount} ${contactText}? This action cannot be undone.`)) {
      return
    }

    deleteContactsMutation.mutate(selectedContacts)
  }

  const contactFields = [
    { key: 'firstName', label: 'First Name', type: 'text', required: false },
    { key: 'lastName', label: 'Last Name', type: 'text', required: false },
    { key: 'phone', label: 'Phone', type: 'tel', required: true },
    { key: 'email', label: 'Email', type: 'email', required: false },
    { key: 'dnc', label: 'Do Not Call', type: 'select', required: false },
    { key: 'propertyAddress', label: 'Property Address', type: 'text', required: false },
    { key: 'propertyCity', label: 'Property City', type: 'text', required: false },
    { key: 'propertyState', label: 'Property State', type: 'text', required: false },
    { key: 'propertyZip', label: 'Property Zip', type: 'text', required: false },
    { key: 'parcelCounty', label: 'Parcel County', type: 'text', required: false },
    { key: 'parcelState', label: 'Parcel State', type: 'text', required: false },
    { key: 'parcelAcres', label: 'Parcel Acres', type: 'number', required: false },
    { key: 'apn', label: 'APN', type: 'text', required: false },
    { key: 'mailingAddress', label: 'Mailing Address', type: 'text', required: false },
    { key: 'mailingCity', label: 'Mailing City', type: 'text', required: false },
    { key: 'mailingState', label: 'Mailing State', type: 'text', required: false },
    { key: 'mailingZip', label: 'Mailing Zip', type: 'text', required: false },
  ]

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedFiles(filteredAndSortedFiles.map(file => file.id))
    } else {
      setSelectedFiles([])
    }
  }

  const handleSelectFile = (fileId: string, checked: boolean) => {
    if (checked) {
      setSelectedFiles([...selectedFiles, fileId])
    } else {
      setSelectedFiles(selectedFiles.filter(id => id !== fileId))
    }
  }

  const handleSelectAllContacts = (checked: boolean) => {
    if (checked) {
      setSelectedContacts(filteredAndSortedContacts.map(contact => contact.id))
    } else {
      setSelectedContacts([])
    }
  }

  const handleSelectContact = (contactId: string, checked: boolean) => {
    if (checked) {
      setSelectedContacts([...selectedContacts, contactId])
    } else {
      setSelectedContacts(selectedContacts.filter(id => id !== contactId))
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !file.name.endsWith('.csv')) {
      toast({
        title: 'Invalid file',
        description: 'Please select a CSV file',
        variant: 'destructive',
      })
      return
    }

    try {
      setUploading(true)
      const reader = new FileReader()
      
      reader.onload = async (e) => {
        try {
          const text = e.target?.result as string
          const lines = text.split('\n').filter(line => line.trim() !== '')
          const contactCount = Math.max(0, lines.length - 1)
          
          // Convert to base64 for API
          const fileContent = btoa(text)
          
          const uploadedSpreadsheet = await contactsApi.uploadSpreadsheet({
            originalFileName: file.name,
            fileContent,
            contactCount,
            fileSize: file.size,
          })
          
          toast({
            title: 'Success',
            description: 'Contact spreadsheet uploaded successfully',
          })
          
          // Reload data
          await loadSpreadsheets()
          await loadStats()
          
          // Open preview dialog for newly uploaded file
          setPreviewDialog({
            open: true,
            spreadsheetId: uploadedSpreadsheet.id,
            fileName: file.name,
            fileContent,
          })
          
        } catch (error) {
          console.error('Upload error:', error)
          toast({
            title: 'Upload failed',
            description: 'Failed to upload contact spreadsheet',
            variant: 'destructive',
          })
        }
      }
      
      reader.readAsText(file)
      
    } catch (error) {
      console.error('File read error:', error)
      toast({
        title: 'Error',
        description: 'Failed to read file',
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
      // Reset file input
      event.target.value = ''
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleDownloadSelected = async () => {
    if (selectedFiles.length === 0) return

    try {
      if (selectedFiles.length === 1) {
        const blob = await contactsApi.downloadSpreadsheet(selectedFiles[0])
        const file = files.find(f => f.id === selectedFiles[0])
        if (file) {
          downloadBlob(blob, file.originalFileName)
        }
      } else {
        const blob = await contactsApi.downloadMultipleSpreadsheets(selectedFiles)
        downloadBlob(blob, `contacts-${selectedFiles.length}-files.zip`)
      }
      
      toast({
        title: 'Success',
        description: 'Files downloaded successfully',
      })
    } catch (error) {
      console.error('Download error:', error)
      toast({
        title: 'Download failed',
        description: 'Failed to download files',
        variant: 'destructive',
      })
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedFiles.length === 0) return

    const fileCount = selectedFiles.length
    const fileText = fileCount === 1 ? 'file' : 'files'

    if (!confirm(`Are you sure you want to permanently delete ${fileCount} ${fileText}? This will also delete all contacts from these spreadsheets. This action cannot be undone.`)) {
      return
    }

    try {
      await contactsApi.deleteMultipleSpreadsheets(selectedFiles)

      toast({
        title: 'Success',
        description: `Deleted ${fileCount} ${fileText} and their contacts`,
      })

      // Clear selection and reload data
      setSelectedFiles([])
      await loadSpreadsheets()
      await loadStats()
    } catch (error) {
      console.error('Delete error:', error)
      toast({
        title: 'Delete failed',
        description: 'Failed to delete files',
        variant: 'destructive',
      })
    }
  }

  const handleRetryConfiguration = async (file: ContactSpreadsheet) => {
    try {
      // Get the file content from the backend
      const spreadsheet = await contactsApi.getSpreadsheet(file.id)

      // Open the preview dialog with the file data
      setPreviewDialog({
        open: true,
        spreadsheetId: file.id,
        fileName: file.originalFileName,
        fileContent: spreadsheet.fileContent,
      })
    } catch (error) {
      console.error('Error getting spreadsheet:', error)
      toast({
        title: 'Error',
        description: 'Failed to load spreadsheet data',
        variant: 'destructive',
      })
    }
  }

  const handleViewDetails = (file: ContactSpreadsheet) => {
    setDetailsDialog({
      open: true,
      spreadsheet: file,
    })
  }

  const handleContactSort = (column: 'firstName' | 'lastName' | 'phone' | 'email') => {
    if (contactSortBy === column) {
      // Toggle sort order if clicking on same column
      setContactSortOrder(contactSortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      // Change to new column, default to ascending
      setContactSortBy(column)  // Error here: Argument of type '"firstName" | "lastName" | "phone" | "email" | "groups"' is not assignable to parameter of type 'SetStateAction<"firstName" | "lastName" | "phone" | "email">'.
//   Type '"groups"' is not assignable to type 'SetStateAction<"firstName" | "lastName" | "phone" | "email">'.ts(2345)
// (parameter) column: "firstName" | "lastName" | "phone" | "email" | "groups"
      setContactSortOrder('asc')
    }
    setCurrentPage(1) // Reset to first page when sorting changes
  }

  const handleSpreadsheetSort = (column: 'status') => {
    if (spreadsheetSortBy === column) {
      // Toggle sort order if clicking on same column
      setSpreadsheetSortOrder(spreadsheetSortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      // For status, default to pending first (asc)
      setSpreadsheetSortBy(column)
      setSpreadsheetSortOrder('asc')
    }
    setCurrentPage(1) // Reset to first page when sorting changes
  }

  const renderSpreadsheetSortIcon = (column: 'status') => {
    if (spreadsheetSortBy !== column) return null
    return spreadsheetSortOrder === 'asc' ?
      <ChevronUp className="h-4 w-4 ml-1" /> :
      <ChevronDown className="h-4 w-4 ml-1" />
  }

  const renderSortIcon = (column: 'firstName' | 'lastName' | 'phone' | 'email') => {
    if (contactSortBy !== column) return null
    return contactSortOrder === 'asc' ?
      <ChevronUp className="h-4 w-4 ml-1" /> :
      <ChevronDown className="h-4 w-4 ml-1" />
  }

  const isAllSelected = selectedFiles.length === filteredAndSortedFiles.length && filteredAndSortedFiles.length > 0
  const isSomeSelected = selectedFiles.length > 0
  const isAllContactsSelected = selectedContacts.length === filteredAndSortedContacts.length && filteredAndSortedContacts.length > 0
  const isSomeContactsSelected = selectedContacts.length > 0

  const getStatusDisplay = (status: string, file: ContactSpreadsheet) => {
    const statusConfig = {
      pending: { dot: 'bg-yellow-500', text: 'Pending' },
      processed: { dot: 'bg-green-500', text: 'Processed' },
      manually_created: { dot: 'bg-blue-500', text: 'Created' },
    }

    const config = statusConfig[status as keyof typeof statusConfig] || { dot: 'bg-gray-400', text: status }

    return (
      <div className='flex items-center gap-2'>
        <div className={`w-2 h-2 rounded-full ${config.dot}`} />
        <span className='text-sm w-16'>{config.text}</span>
        <div className='flex items-center'>
          {status === 'pending' && (
            <Button
              size='sm'
              variant='ghost'
              onClick={(e) => {
                e.stopPropagation()
                handleRetryConfiguration(file)
              }}
              className='gap-1 h-6 px-2'
              title='Retry configuration'
            >
              <RefreshCw className='h-3 w-3' />
            </Button>
          )}
          {status === 'processed' && (
            <Button
              size='sm'
              variant='ghost'
              onClick={(e) => {
                e.stopPropagation()
                handleViewDetails(file)
              }}
              className='gap-1 h-6 px-2'
              title='View processing details'
            >
              <Eye className='h-3 w-3' />
            </Button>
          )}
          {/* No buttons for manually_created status */}
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full overflow-hidden'>
      {/* Sidebar */}
      <div className='w-64 border-r bg-background/50 p-4 flex flex-col h-full overflow-hidden'>
        <div className='space-y-2 flex-shrink-0'>
          <Button
            variant={selectedMode === 'spreadsheets' ? 'default' : 'ghost'}
            className='w-full justify-start text-sm'
            onClick={() => {
              setSelectedMode('spreadsheets')
              setCurrentPage(1)
              setSearchQuery('')
            }}
          >
            <FileSpreadsheet className='mr-2 h-4 w-4' />
            Contact groups ({totalFiles})
          </Button>
          <Button
            variant={selectedMode === 'all' ? 'default' : 'ghost'}
            className='w-full justify-start text-sm'
            onClick={() => {
              setSelectedMode('all')
              setCurrentPage(1)
              setSearchQuery('')
            }}
          >
            <Users className='mr-2 h-4 w-4' />
            All contacts ({totalContacts.toLocaleString()})
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className={selectedContact && selectedMode === 'all' ? 'flex-1 flex h-full overflow-hidden' : 'flex-1 flex flex-col h-full overflow-hidden'}>
        <div className='flex-1 flex flex-col h-full'>
        {/* Header */}
        <div className='border-b p-4 flex-shrink-0'>
          <div className='flex items-center justify-between mb-4'>
            <h2 className='text-lg font-semibold'>
              {selectedMode === 'spreadsheets' && 'Contact groups'}
              {selectedMode === 'all' && 'All contacts'}
            </h2>
            <div className='relative w-80'>
              <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground' />
              <Input
                placeholder={selectedMode === 'spreadsheets' ? 'Search contact groups...' : 'Search contacts...'}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1) // Reset to first page when searching
                }}
                className='pl-10'
              />
            </div>
          </div>

          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-4'>
              {selectedMode === 'spreadsheets' && (
                <>
                  <Button
                    className='gap-2'
                    onClick={handleUploadClick}
                    disabled={uploading}
                  >
                    <Upload className='h-4 w-4' />
                    {uploading ? 'Uploading...' : 'Upload contacts'}
                  </Button>
                  <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
                    <DialogTrigger asChild>
                      <Button className='gap-2' variant='outline' onClick={loadAvailableContacts}>
                        <UserPlus className='h-4 w-4' />
                        Create group
                      </Button>
                    </DialogTrigger>
                    <DialogContent className='max-w-3xl max-h-[80vh] overflow-hidden flex flex-col'>
                      <DialogHeader>
                        <DialogTitle>Create New Contact Group</DialogTitle>
                      </DialogHeader>
                      <div className='flex-1 flex flex-col overflow-hidden'>
                        <div className='space-y-4 flex-shrink-0'>
                          <div>
                            <Label htmlFor="group-name" className='text-sm font-medium'>
                              Group Name <span className='text-red-500'>*</span>
                            </Label>
                            <Input
                              id="group-name"
                              value={createGroupData.name}
                              onChange={(e) => setCreateGroupData(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Enter group name"
                              className='mt-1'
                            />
                          </div>
                          <div>
                            <Label htmlFor="group-description" className='text-sm font-medium'>
                              Description (optional)
                            </Label>
                            <Textarea
                              id="group-description"
                              value={createGroupData.description}
                              onChange={(e) => setCreateGroupData(prev => ({ ...prev, description: e.target.value }))}
                              placeholder="Enter group description"
                              className='mt-1'
                              rows={2}
                            />
                          </div>
                        </div>

                        <div className='mt-6 flex-1 flex flex-col overflow-hidden'>
                          <div className='mb-4'>
                            <Label className='text-sm font-medium'>
                              Select Contacts <span className='text-red-500'>*</span>
                            </Label>
                          </div>

                          {/* Search input */}
                          <div className='mb-4'>
                            <div className='relative'>
                              <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                              <Input
                                placeholder='Search by name or phone number...'
                                value={contactSearchQuery}
                                onChange={(e) => setContactSearchQuery(e.target.value)}
                                className='pl-10'
                              />
                            </div>
                            {totalAvailableContacts > 0 && (
                              <div className='text-xs text-muted-foreground mt-1'>
                                Showing {availableContacts.length} of {totalAvailableContacts} contacts
                                {contactSearchQuery && ' (filtered)'}
                              </div>
                            )}
                          </div>

                          <div className='border rounded-md overflow-hidden' style={{ height: `${contactListHeight}px` }}>
                            {loadingAvailableContacts ? (
                              <div className='flex items-center justify-center h-full py-8'>
                                <div className='text-muted-foreground'>Loading contacts...</div>
                              </div>
                            ) : availableContacts.length === 0 ? (
                              <div className='flex items-center justify-center h-full py-8'>
                                <div className='text-muted-foreground'>No contacts available</div>
                              </div>
                            ) : availableContacts.length === 0 && contactSearchQuery ? (
                              <div className='flex items-center justify-center h-full py-8'>
                                <div className='text-muted-foreground'>No contacts match your search</div>
                              </div>
                            ) : (
                              <div ref={contactListRef} className='h-full overflow-y-auto'>
                                <div className='divide-y'>
                                  {availableContacts.map((contact) => {
                                    const displayName = contact.firstName || contact.lastName
                                      ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
                                      : contact.phone

                                    return (
                                      <div key={contact.id} className='flex items-center space-x-3 p-3 hover:bg-muted/50'>
                                        <Checkbox
                                          checked={createGroupData.selectedContacts.includes(contact.id)}
                                          onCheckedChange={(checked) => handleToggleContactInGroup(contact.id, checked as boolean)}
                                        />
                                        <div className='flex-1'>
                                          <div className='font-medium'>{displayName}</div>
                                          {contact.firstName && (
                                            <div className='text-sm text-muted-foreground'>{contact.phone}</div>
                                          )}
                                          {contact.email && (
                                            <div className='text-sm text-muted-foreground'>{contact.email}</div>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                  {loadingMoreContacts && (
                                    <div className='flex items-center justify-center py-4'>
                                      <div className='text-muted-foreground text-sm'>Loading more contacts...</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant='outline'
                          onClick={() => setCreateGroupOpen(false)}
                          disabled={createGroupMutation.isPending}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleCreateGroup}
                          disabled={createGroupMutation.isPending || !createGroupData.name.trim() || createGroupData.selectedContacts.length === 0}
                        >
                          {createGroupMutation.isPending ? 'Creating...' : `Create Group (${createGroupData.selectedContacts.length} selected)`}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='.csv'
                    onChange={handleFileUpload}
                    className='hidden'
                  />
                  <div className='flex flex-col gap-1'>
                    <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                      <SelectTrigger className='w-32'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='newest'>Newest</SelectItem>
                        <SelectItem value='oldest'>Oldest</SelectItem>
                        <SelectItem value='a-z'>A → Z</SelectItem>
                        <SelectItem value='z-a'>Z → A</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {selectedMode === 'all' && (
                <Dialog open={createContactOpen} onOpenChange={setCreateContactOpen}>
                  <DialogTrigger asChild>
                    <Button className='gap-2'>
                      <Plus className='h-4 w-4' />
                      Create new contact
                    </Button>
                  </DialogTrigger>
                  <DialogContent className='max-w-2xl max-h-[80vh] overflow-y-auto'>
                    <DialogHeader>
                      <DialogTitle>Create New Contact</DialogTitle>
                    </DialogHeader>
                    <div className='space-y-4 py-4'>
                      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                        {contactFields.map((field) => {
                          const value = createContactData[field.key]
                          const displayValue = field.type === 'number' && value === 0 ? '' : value

                          return (
                            <div key={field.key} className={field.key === 'propertyAddress' || field.key === 'mailingAddress' ? 'md:col-span-2' : ''}>
                              <Label htmlFor={field.key} className='text-sm font-medium'>
                                {field.label}{field.required && <span className='text-red-500'>*</span>}
                              </Label>
                              {field.key === 'propertyAddress' || field.key === 'mailingAddress' ? (
                                <Textarea
                                  id={field.key}
                                  value={displayValue || ''}
                                  onChange={(e) => {
                                    setCreateContactData(prev => ({ ...prev, [field.key]: e.target.value }))
                                  }}
                                  className='mt-1'
                                  placeholder={`Enter ${field.label.toLowerCase()}`}
                                  rows={2}
                                />
                              ) : field.type === 'select' && field.key === 'dnc' ? (
                                <select
                                  id={field.key}
                                  value={value === null ? 'unknown' : value ? 'yes' : 'no'}
                                  onChange={(e) => {
                                    const newValue = e.target.value === 'unknown' ? null : e.target.value === 'yes'
                                    setCreateContactData(prev => ({ ...prev, [field.key]: newValue }))
                                  }}
                                  className='mt-1 rounded border border-input px-3 py-2 text-sm w-full'
                                >
                                  <option value="unknown">Unknown</option>
                                  <option value="yes">Yes</option>
                                  <option value="no">No</option>
                                </select>
                              ) : (
                                <Input
                                  id={field.key}
                                  type={field.type}
                                  value={displayValue || ''}
                                  onChange={(e) => {
                                    const newValue = field.type === 'number'
                                      ? (e.target.value ? parseFloat(e.target.value) : 0)
                                      : e.target.value
                                    setCreateContactData(prev => ({ ...prev, [field.key]: newValue }))
                                  }}
                                  className='mt-1'
                                  placeholder={`Enter ${field.label.toLowerCase()}`}
                                  required={field.required}
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant='outline'
                        onClick={() => setCreateContactOpen(false)}
                        disabled={createContactMutation.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleCreateContact}
                        disabled={createContactMutation.isPending || !createContactData.phone.trim()}
                      >
                        {createContactMutation.isPending ? 'Creating...' : 'Create Contact'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>

            <div className='flex items-center gap-4'>
              {selectedMode === 'spreadsheets' && isSomeSelected && (
                <div className='flex items-center gap-2'>
                  <Badge variant='secondary'>{selectedFiles.length} selected</Badge>
                  <Button
                    size='sm'
                    variant='outline'
                    className='gap-2'
                    onClick={handleDownloadSelected}
                  >
                    <Download className='h-4 w-4' />
                    Download
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='gap-2'
                    onClick={handleDeleteSelected}
                  >
                    <Trash2 className='h-4 w-4' />
                    Delete
                  </Button>
                </div>
              )}
              {selectedMode === 'all' && isSomeContactsSelected && (
                <div className='flex items-center gap-2'>
                  <Badge variant='secondary'>{selectedContacts.length} selected</Badge>
                  <Button
                    size='sm'
                    variant='outline'
                    className='gap-2'
                    onClick={handleDeleteSelectedContacts}
                    disabled={deleteContactsMutation.isPending}
                  >
                    <Trash2 className='h-4 w-4' />
                    {deleteContactsMutation.isPending ? 'Deleting...' : 'Delete contact(s)'}
                  </Button>
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
          {loading ? (
            <div className='flex items-center justify-center h-full'>
              <div className='text-muted-foreground'>Loading...</div>
            </div>
          ) : selectedMode === 'spreadsheets' ? (
            totalFiles === 0 ? (
              <div className='flex flex-col items-center justify-center h-full py-16'>
                <FileSpreadsheet className='h-16 w-16 text-muted-foreground/50 mb-4' />
                <h3 className='text-lg font-semibold text-muted-foreground mb-2'>No contact spreadsheets</h3>
                <p className='text-sm text-muted-foreground mb-6 text-center max-w-md'>
                  Upload your first CSV file to get started managing your contacts.
                </p>
                <Button className='gap-2' onClick={handleUploadClick}>
                  <Upload className='h-4 w-4' />
                  Upload contacts
                </Button>
              </div>
            ) : (
              <table className='w-full'>
                <thead className='sticky top-0 z-10 border-b bg-muted'>
                  <tr>
                    <th className='w-12 p-4'>
                      <Checkbox
                        checked={isAllSelected}
                        onCheckedChange={handleSelectAll}
                      />
                    </th>
                    <th className='text-left p-4 font-medium'>Group name</th>
                    <th
                      className='text-left p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors'
                      onClick={() => handleSpreadsheetSort('status')}
                    >
                      <div className='flex items-center'>
                        Status
                        {renderSpreadsheetSortIcon('status')}
                      </div>
                    </th>
                    <th className='text-left p-4 font-medium'>CSV rows</th>
                    <th className='text-left p-4 font-medium'>Contacts</th>
                    <th className='text-left p-4 font-medium'>Non-DNC</th>
                    <th className='text-left p-4 font-medium'>DNC</th>
                    <th className='text-left p-4 font-medium'>Date created</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedFiles.map((file) => (
                    <tr key={file.id} className='border-b hover:bg-muted/25'>
                      <td className='p-4'>
                        <Checkbox
                          checked={selectedFiles.includes(file.id)}
                          onCheckedChange={(checked) => handleSelectFile(file.id, checked as boolean)}
                        />
                      </td>
                      <td className='p-4'>
                        <div className='flex items-center gap-2'>
                          <div>
                            <div className='font-medium'>{file.originalFileName}</div>
                          </div>
                        </div>
                      </td>
                      <td className='p-4'>
                        {getStatusDisplay(file.status, file)}
                      </td>
                      <td className='p-4 text-muted-foreground'>
                        {file.contactCount.toLocaleString()}
                      </td>
                      <td className='p-4 text-muted-foreground'>
                        {file.status === 'pending' ? '-' : (file.validContactsCount?.toLocaleString() ?? '-')}
                      </td>
                      <td className='p-4 text-muted-foreground'>
                        {file.status === 'pending' ? '-' : (file.nonDncCount?.toLocaleString() ?? '-')}
                      </td>
                      <td className='p-4 text-muted-foreground'>
                        {file.status === 'pending' ? '-' : (file.dncCount?.toLocaleString() ?? '-')}
                      </td>
                      <td className='p-4 text-muted-foreground'>
                        {file.uploadDate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            // All contacts view
            totalContacts === 0 ? (
              <div className='flex flex-col items-center justify-center h-full py-16'>
                <Users className='h-16 w-16 text-muted-foreground/50 mb-4' />
                <h3 className='text-lg font-semibold text-muted-foreground mb-2'>No contacts</h3>
                <p className='text-sm text-muted-foreground mb-6 text-center max-w-md'>
                  Upload and process CSV files to see individual contacts here.
                </p>
              </div>
            ) : (
              <table className='w-full'>
                <thead className='sticky top-0 z-10 border-b bg-muted'>
                  <tr>
                    <th className='w-12 p-4'>
                      <Checkbox
                        checked={isAllContactsSelected}
                        onCheckedChange={handleSelectAllContacts}
                      />
                    </th>
                    <th
                      className='text-left p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors'
                      onClick={() => handleContactSort('firstName')}
                    >
                      <div className='flex items-center'>
                        First name
                        {renderSortIcon('firstName')}
                      </div>
                    </th>
                    <th 
                      className='text-left p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors'
                      onClick={() => handleContactSort('lastName')}
                    >
                      <div className='flex items-center'>
                        Last name
                        {renderSortIcon('lastName')}
                      </div>
                    </th>
                    <th 
                      className='text-left p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors'
                      onClick={() => handleContactSort('phone')}
                    >
                      <div className='flex items-center'>
                        Phone
                        {renderSortIcon('phone')}
                      </div>
                    </th>
                    <th
                      className='text-left p-4 font-medium cursor-pointer hover:bg-muted/75 transition-colors'
                      onClick={() => handleContactSort('email')}
                    >
                      <div className='flex items-center'>
                        Email
                        {renderSortIcon('email')}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedContacts.map((contact) => (
                    <tr
                      key={contact.id}
                      className={cn(
                        'border-b hover:bg-muted/25 transition-colors',
                        selectedContact?.id === contact.id && 'bg-primary/10 border-l-4 border-l-primary'
                      )}
                    >
                      <td className='p-4'>
                        <Checkbox
                          checked={selectedContacts.includes(contact.id)}
                          onCheckedChange={(checked) => handleSelectContact(contact.id, checked as boolean)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td
                        className='p-4 text-muted-foreground cursor-pointer'
                        onClick={() => setSelectedContact(contact)}
                      >
                        {contact.firstName}
                      </td>
                      <td
                        className='p-4 text-muted-foreground cursor-pointer'
                        onClick={() => setSelectedContact(contact)}
                      >
                        {contact.lastName}
                      </td>
                      <td
                        className='p-4 text-muted-foreground cursor-pointer'
                        onClick={() => setSelectedContact(contact)}
                      >
                        {contact.phone}
                      </td>
                      <td
                        className='p-4 text-muted-foreground cursor-pointer'
                        onClick={() => setSelectedContact(contact)}
                      >
                        {contact.email || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>

        {/* Pagination - Always at bottom */}
        <div className='border-t p-4 mt-auto flex-shrink-0'>
          {((selectedMode === 'spreadsheets' && totalFiles > 0) || (selectedMode === 'all' && totalContacts > 0)) ? (
            <div className='flex items-center justify-between'>
              <div className='text-sm text-muted-foreground'>
                {selectedMode === 'spreadsheets' ? (
                  `Showing 1-${Math.min(displayCount, totalFiles)} of ${totalFiles} files`
                ) : (
                  `Showing 1-${Math.min(displayCount, contacts.length)} of ${filteredContactsTotal} contacts`
                )}
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
                  Page {currentPage} of {Math.ceil((selectedMode === 'spreadsheets' ? totalFiles : filteredContactsTotal) / displayCount) || 1}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setCurrentPage(Math.min(Math.ceil((selectedMode === 'spreadsheets' ? totalFiles : filteredContactsTotal) / displayCount), currentPage + 1))}
                  disabled={currentPage >= Math.ceil((selectedMode === 'spreadsheets' ? totalFiles : filteredContactsTotal) / displayCount)}
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

        {/* Contact sidebar */}
        {selectedContact && selectedMode === 'all' && (
          <div className="w-96 flex-shrink-0 h-full overflow-hidden">
            <ContactSidebar
              contact={selectedContact}
              onClose={() => setSelectedContact(null)}
            />
          </div>
        )}
      </div>

      <CsvPreviewDialog
          open={previewDialog.open}
          onOpenChange={(open) => setPreviewDialog(prev => ({ ...prev, open }))}
          spreadsheetId={previewDialog.spreadsheetId}
          fileName={previewDialog.fileName}
          fileContent={previewDialog.fileContent}
          onProcessComplete={async () => {
            await loadSpreadsheets()
            await loadStats()
          }}
        />

      <ProcessingDetailsDialog
          open={detailsDialog.open}
          onOpenChange={(open) => setDetailsDialog(prev => ({ ...prev, open }))}
          spreadsheet={detailsDialog.spreadsheet}
        />
    </div>
  )
}