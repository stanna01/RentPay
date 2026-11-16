import { Tabs } from 'expo-router/js-tabs';

import { tabIcon, tabScreenOptions } from '@/components/role-tabs';

export default function StudentLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home-outline') }} />
      <Tabs.Screen name="bills" options={{ title: 'Bills', tabBarIcon: tabIcon('document-text-outline') }} />
      <Tabs.Screen name="receipts" options={{ title: 'Receipts', tabBarIcon: tabIcon('receipt-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  );
}
