import { Tabs } from 'expo-router/js-tabs';

import { tabIcon, tabScreenOptions } from '@/components/role-tabs';

export default function SponsorLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: 'My students', tabBarIcon: tabIcon('people-outline') }} />
      <Tabs.Screen name="payments" options={{ title: 'Payments', tabBarIcon: tabIcon('receipt-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  );
}
