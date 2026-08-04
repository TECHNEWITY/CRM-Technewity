//@ts-check

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { composePlugins, withNx } = require('@nx/next')

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  output: 'standalone',
  nx: {
    // Set this to true if you would like to use SVGR
    // See: https://github.com/gregberge/svgr
    svgr: false
  },
  webpack: config => {
    config.resolve.alias.canvas = false
    return config
  }
}

/**
 * @param {any} config
 * @returns {any}
 */
const safeWithNx = (config) => {
  const withNxFn = withNx(config)
  /**
   * @param {string} phase
   * @param {any} context
   */
  return async (phase, context) => {
    try {
      return await withNxFn(phase, context)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.warn('[Nx Plugin Warning] Failed to initialize withNx. Running in fallback mode:', message)
      const { nx, ...rest } = config
      return {
        ...rest,
        distDir: '.next'
      }
    }
  }
}

const plugins = [
  safeWithNx
]

module.exports = composePlugins(...plugins)(nextConfig)



