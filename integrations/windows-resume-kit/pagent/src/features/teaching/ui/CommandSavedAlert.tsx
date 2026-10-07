import { IconCheck } from '@tabler/icons-react';
import type { SavedCommand } from '@/shared/contracts/teaching';
import { AnimatedToastStack } from '@/shared/ui/beui/animated-toast-stack';

export function CommandSavedAlert({ command }: { command: SavedCommand }) {
  return (
    <AnimatedToastStack
      placement="static"
      className="max-w-none"
      toasts={[
        {
          id: `saved-${command.key}`,
          title: '命令已保存',
          description: (
            <span>
              已固化到当前网站 Vault · <code className="font-mono text-foreground">/{command.key}</code>
            </span>
          ),
          status: 'success',
          icon: <IconCheck size={14} />,
          dismissible: false,
        },
      ]}
    />
  );
}
