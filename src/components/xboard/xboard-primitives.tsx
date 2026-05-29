import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  type SxProps,
  type Theme,
  Stack,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'

interface PanelProps {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  sx?: SxProps<Theme>
}

export const XboardPanel = ({ title, action, children, sx }: PanelProps) => (
  <Paper
    elevation={0}
    sx={[
      {
        p: 2,
        border: '1px solid',
        borderColor: '#dfe5e2',
        borderRadius: 1,
        bgcolor: '#fff',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
      },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}
  >
    {(title || action) && (
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          mb: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          minWidth: 0,
        }}
      >
        <Typography variant="subtitle1" sx={{ minWidth: 0, fontWeight: 800 }}>
          {title}
        </Typography>
        {action}
      </Stack>
    )}
    {children}
  </Paper>
)

export const XboardMetric = ({
  label,
  value,
  helper,
  sx,
  valueSx,
}: {
  label: ReactNode
  value: ReactNode
  helper?: ReactNode
  sx?: SxProps<Theme>
  valueSx?: SxProps<Theme>
}) => (
  <Box
    sx={[
      {
        minWidth: 0,
        minHeight: 86,
        p: 1.5,
        borderRadius: 1,
        bgcolor: '#fff',
        border: '1px solid',
        borderColor: '#dfe5e2',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
      },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}
  >
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography
      variant="h6"
      sx={[
        {
          mt: 0.25,
          fontWeight: 800,
          lineHeight: 1.35,
          overflowWrap: 'break-word',
          wordBreak: 'normal',
        },
        ...(Array.isArray(valueSx) ? valueSx : valueSx ? [valueSx] : []),
      ]}
    >
      {value}
    </Typography>
    {helper && (
      <Typography variant="caption" color="text.secondary">
        {helper}
      </Typography>
    )}
  </Box>
)

export const XboardStatusChip = ({
  status,
  label,
}: {
  status: 'success' | 'warning' | 'error' | 'default' | 'info'
  label: string
}) => (
  <Chip size="small" color={status} label={label} sx={{ fontWeight: 700 }} />
)

export const XboardEmpty = ({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) => (
  <Box
    sx={{
      minHeight: 180,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      p: 3,
      border: '1px dashed',
      borderColor: '#d8e0dc',
      borderRadius: 1,
      bgcolor: '#fff',
    }}
  >
    <Stack spacing={1.2} sx={{ alignItems: 'center' }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      )}
      {action}
    </Stack>
  </Box>
)

export const XboardTrafficBar = ({
  used,
  total,
}: {
  used: number
  total: number
}) => {
  const percent = total > 0 ? Math.min((used / total) * 100, 100) : 0
  const color = percent > 90 ? 'error' : percent > 75 ? 'warning' : 'success'

  return (
    <Stack spacing={0.75}>
      <LinearProgress
        variant="determinate"
        value={percent}
        color={color}
        sx={{ height: 8, borderRadius: 1 }}
      />
      <Typography variant="caption" color="text.secondary">
        已使用 {percent.toFixed(1)}%
      </Typography>
    </Stack>
  )
}

export const XboardActionButton = ({
  children,
  ...props
}: React.ComponentProps<typeof Button>) => (
  <Button
    variant="contained"
    disableElevation
    sx={{ borderRadius: 1, fontWeight: 800, minHeight: 42 }}
    {...props}
  >
    {children}
  </Button>
)
