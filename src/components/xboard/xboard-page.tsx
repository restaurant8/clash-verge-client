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
        p: 2.25,
        bgcolor: 'var(--page-background-color)',
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{
          mb: 2,
          alignItems: 'center',
          justifyContent: 'space-between',
          minWidth: 0,
        }}
        data-tauri-drag-region="true"
      >
        <Box sx={{ minWidth: 0 }} data-tauri-drag-region="true">
          <Typography variant="h5" sx={{ fontWeight: 900, lineHeight: 1.15 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
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
