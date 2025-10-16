const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://textbee.dev'
const isDevelopment = siteUrl.includes('localhost')

export const Routes = {
  landingPage: siteUrl,
  contribute: '/contribute',
  useCases: `${siteUrl}/use-cases`,
  quickstart: `${siteUrl}/quickstart`,
  login: '/login',
  register: '/register',
  logout: '/logout',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',

  dashboard: '/dashboard',

  downloadAndroidApp: `${siteUrl}/download`,
  downloadAPK: isDevelopment
    ? '/textbee.apk'
    : `${siteUrl}/textbee.apk`,
  privacyPolicy: `${siteUrl}/privacy-policy`,
  refundPolicy: `${siteUrl}/refund-policy`,
  termsOfService: `${siteUrl}/terms-of-service`,
  statusPage: `${siteUrl.replace('https://', 'https://status.')}`,
}
