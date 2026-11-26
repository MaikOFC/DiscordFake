import { NicknameScreen } from './components/NicknameScreen';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { useAppStore } from './store/useAppStore';

export function App() {
  const connectionStatus = useAppStore((state) => state.connectionStatus);

  if (connectionStatus === 'connected') {
    return <WorkspaceLayout />;
  }

  return <NicknameScreen />;
}
