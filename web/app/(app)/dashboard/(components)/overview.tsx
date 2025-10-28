'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, Smartphone, Key, MessageSquare, TrendingUp, Calendar, Filter, ChevronDown } from 'lucide-react'
import GetStartedCard from './get-started'
import { ApiEndpoints } from '@/config/api'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { formatPhoneNumberDisplay } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface Device {
  _id: string
  brand: string
  model: string
  enabled: boolean
  phoneNumber?: string
  current_tier?: number
}

export const StatCard = ({ title, value, icon: Icon, description }) => {
  return (
    <Card className="overflow-hidden transition-all hover:shadow-md">
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        <div className="rounded-full bg-primary/10 p-2">
          <Icon className='h-4 w-4 text-primary' />
        </div>
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold'>
          {value !== undefined ? value : <Skeleton className='h-6 w-16' />}
        </div>
        <p className='text-xs text-muted-foreground mt-1 flex items-center'>
          {description}
          {value !== undefined && <TrendingUp className="ml-1 h-3 w-3 text-green-500" />}
        </p>
      </CardContent>
    </Card>
  )
}

export default function Overview() {
  // Calculate default date range (last 30 days)
  const getDefaultDateRange = () => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 30)
    return { from: start, to: end }
  }

  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>(getDefaultDateRange())
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showDeviceSelector, setShowDeviceSelector] = useState(false)

  // Fetch devices
  const { data: devicesData } = useQuery<{ data: Device[] }>({
    queryKey: ['devices'],
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.listDevices())
        .then((res) => res.data),
  })

  const devices = devicesData?.data || []

  // Initialize selected devices to all devices when devices are loaded
  useEffect(() => {
    if (devices.length > 0 && selectedDeviceIds.length === 0) {
      setSelectedDeviceIds(devices.map((d) => d._id))
    }
  }, [devices, selectedDeviceIds.length])

  // Fetch stats with filters
  const { data: stats } = useQuery({
    queryKey: ['stats', dateRange, selectedDeviceIds],
    queryFn: () => {
      const params = new URLSearchParams()

      if (dateRange?.from) {
        params.append('startDate', dateRange.from.toISOString())
      }
      if (dateRange?.to) {
        params.append('endDate', dateRange.to.toISOString())
      }
      if (selectedDeviceIds.length > 0 && selectedDeviceIds.length < devices.length) {
        selectedDeviceIds.forEach((id) => params.append('deviceIds', id))
      }

      const url = `${ApiEndpoints.gateway.getStats()}?${params.toString()}`
      return httpBrowserClient.get(url).then((res) => res.data?.data)
    },
    enabled: selectedDeviceIds.length > 0,
  })

  const formatDateRange = () => {
    if (!dateRange?.from) return 'Select date range'

    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }

    if (dateRange.to) {
      return `${formatDate(dateRange.from)} - ${formatDate(dateRange.to)}`
    }
    return formatDate(dateRange.from)
  }

  const getDeviceSelectorLabel = () => {
    if (selectedDeviceIds.length === 0) return 'No devices selected'
    if (selectedDeviceIds.length === devices.length) return 'All devices'
    return `${selectedDeviceIds.length} of ${devices.length} devices`
  }

  const handleSelectAllDevices = (checked: boolean) => {
    if (checked) {
      setSelectedDeviceIds(devices.filter((d) => d.enabled).map((d) => d._id))
    } else {
      setSelectedDeviceIds([])
    }
  }

  const handleDeviceToggle = (deviceId: string) => {
    setSelectedDeviceIds((prev) =>
      prev.includes(deviceId)
        ? prev.filter((id) => id !== deviceId)
        : [...prev, deviceId]
    )
  }

  const dateRangeDescription = dateRange?.from && dateRange?.to
    ? `${dateRange.from.toLocaleDateString()} - ${dateRange.to.toLocaleDateString()}`
    : 'Select date range'

  return (
    <div className='space-y-6'>
      <GetStartedCard />

      {/* Filter Controls */}
      <div className='flex gap-3 items-center flex-wrap'>
        {/* Date Range Picker */}
        <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="justify-start text-left font-normal">
              <Calendar className="mr-2 h-4 w-4" />
              {formatDateRange()}
              <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-4" align="start">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">From:</Label>
                <Input
                  type="date"
                  value={dateRange?.from?.toISOString().split('T')[0] || ''}
                  onChange={(e) => {
                    const date = e.target.value ? new Date(e.target.value) : undefined
                    setDateRange({ ...dateRange, from: date })
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">To:</Label>
                <Input
                  type="date"
                  value={dateRange?.to?.toISOString().split('T')[0] || ''}
                  onChange={(e) => {
                    const date = e.target.value ? new Date(e.target.value) : undefined
                    setDateRange({ ...dateRange, to: date })
                  }}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Device Selector */}
        <Popover open={showDeviceSelector} onOpenChange={setShowDeviceSelector}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="justify-start text-left font-normal">
              <Filter className="mr-2 h-4 w-4" />
              {getDeviceSelectorLabel()}
              <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96" align="start">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <Label className="text-sm font-medium">Select Devices</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={
                      devices.filter((d) => d.enabled).length > 0 &&
                      devices
                        .filter((d) => d.enabled)
                        .every((d) => selectedDeviceIds.includes(d._id))
                    }
                    onCheckedChange={handleSelectAllDevices}
                  />
                  <span className="text-xs text-muted-foreground">Select all</span>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto space-y-2">
                {devices.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No devices found
                  </p>
                ) : (
                  devices.map((device) => (
                    <div
                      key={device._id}
                      className="flex items-center justify-between p-2 rounded border bg-background hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center space-x-2 flex-1">
                        <Checkbox
                          checked={selectedDeviceIds.includes(device._id)}
                          disabled={!device.enabled}
                          onCheckedChange={() => handleDeviceToggle(device._id)}
                        />
                        <div className={`text-sm ${!device.enabled ? 'opacity-50' : ''}`}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {device.brand} {device.model}
                            </span>
                            <Badge
                              variant={device.enabled ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {device.enabled ? 'Enabled' : 'Disabled'}
                            </Badge>
                          </div>
                          {device.phoneNumber && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {formatPhoneNumberDisplay(device.phoneNumber)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Stats Grid */}
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-5'>
        <StatCard
          title='SMS Sent'
          value={stats?.totalSentSMSCount?.toLocaleString()}
          icon={MessageSquare}
          description={dateRangeDescription}
        />
        <StatCard
          title='SMS Received'
          value={stats?.totalReceivedSMSCount?.toLocaleString()}
          icon={BarChart3}
          description={dateRangeDescription}
        />
        <StatCard
          title='SMS Delivery Rate'
          value={stats?.smsDeliveryRate !== undefined ? `${stats.smsDeliveryRate}%` : undefined}
          icon={TrendingUp}
          description='Of sent messages'
        />
        <StatCard
          title='Active Devices'
          value={stats?.totalDeviceCount}
          icon={Smartphone}
          description='Connected now'
        />
        <StatCard
          title='API Keys'
          value={stats?.totalApiKeyCount}
          icon={Key}
          description='Active keys'
        />
      </div>
    </div>
  )
}
