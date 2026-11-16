import { Tabs } from 'expo-router/js-tabs';

import { tabIcon, tabScreenOptions } from '@/components/role-tabs';

export default function LandlordLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: tabIcon('stats-chart-outline') }} />
      <Tabs.Screen name="verify" options={{ title: 'Bank slips', tabBarIcon: tabIcon('checkmark-done-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  );
}
