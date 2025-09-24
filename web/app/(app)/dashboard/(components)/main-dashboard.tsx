'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import Overview from './overview'
import DeviceList from './device-list'
import UsagePlans from './usage-plans'
import ApiKeys from './api-keys'
import Messaging from './messaging'
import WebhooksSection from './webhooks/webhooks-section'

export default function DashboardOverview() {

  const [currentTab, setCurrentTab] = useState('overview')

  const handleTabChange = (value: string) => {
    setCurrentTab(value)
  }

  return (
    <Tabs
      value={currentTab}
      onValueChange={handleTabChange}
      className='space-y-4'
    >
      <TabsList className='sticky top-[4rem] z-10 flex mx-auto max-w-md border-[1px] my-6 bg-brand-500 text-white '>
        <TabsTrigger value='overview' className='flex-1'>
          Overview
        </TabsTrigger>
        <TabsTrigger value='messaging' className='relative flex-1'>
          <MessageSquare className='ml-2 h-4 w-4' />
          <span className='mx-2'>Messaging</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value='overview' className='space-y-4'>
        <Overview />

        <div className='grid gap-4 md:grid-cols-2'>
          <DeviceList />
          <ApiKeys />
        </div>

        {console.log('🔧 About to render UsagePlans component')}
        {(() => {
          try {
            return <UsagePlans />
          } catch (error) {
            console.error('🔧 UsagePlans component error:', error)
            return <div className="p-4 border border-red-500 rounded">UsagePlans component failed to render: {String(error)}</div>
          }
        })()}

        <WebhooksSection />
      </TabsContent>

      <TabsContent value='messaging'>
        <Messaging />
      </TabsContent>
    </Tabs>
  )
}
