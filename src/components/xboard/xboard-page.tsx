import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

export const XboardPage = ({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}) => (
  <Box sx={{ height: '100%', display: 'flex', minWidth: 0 }}>
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        overflow: 'auto',
        p: 2,
        bgcolor: '#eeeeee',
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{
          mb: 2,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
        data-tauri-drag-region="true"
      >
        <Box data-tauri-drag-region="true">
          <Typography variant="h5" sx={{ fontWeight: 900 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Stack>
      {children}
    </Box>
  </Box>
)
