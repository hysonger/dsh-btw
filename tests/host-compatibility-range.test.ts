import { describe, expect, it } from 'vitest'
import semver from 'semver'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadPluginManifest() {
  let pkgPath = resolve(__dirname, '../package.json')
  let pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (!pkg.engines?.dsh) {
    // 处于 test:compat 隔离子目录 (.cache/compatibility/<version>) 中
    const rootPkgPath = resolve(__dirname, '../../../../package.json')
    if (existsSync(rootPkgPath)) {
      pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
    }
  }
  return pkg
}

const pkg = loadPluginManifest()

// 加固 fork 只准入精确验证过的宿主 0.2.2-rc.3（扁平 startActivation + childId 预登记契约）；
// 旧宿主（含 0.2.2-rc.2 及更早的 request 包装 spec / send_message({ agent_id })）一律拦截。
const EXACT_DSH = '0.2.2-rc.3'

describe('DSH 宿主准入范围契约 (engines.dsh)', () => {
  it('声明了精确的 engines.dsh 版本，仅放行 0.2.2-rc.3', () => {
    expect(pkg.engines?.dsh).toBe(EXACT_DSH)
  })

  it('按 DSH 官方宿主版本门规则 (includePrerelease: true) 仅放行精确版本', () => {
    const range = pkg.engines.dsh
    const check = (version: string) => semver.satisfies(version, range, { includePrerelease: true })

    // 精确验证过的版本放行
    expect(check('0.2.2-rc.3')).toBe(true)

    // 更早的 rc、补丁与旧代际全部拦截（契约已收敛，不再宽进）
    expect(check('0.2.0-rc.1')).toBe(false)
    expect(check('0.2.0-rc.2')).toBe(false)
    expect(check('0.2.1-rc.1')).toBe(false)
    expect(check('0.2.1-rc.3')).toBe(false)
    expect(check('0.2.2-alpha.1')).toBe(false)
    expect(check('0.2.2-rc.1')).toBe(false)
    expect(check('0.2.2-rc.2')).toBe(false)
    expect(check('0.2.2-rc.4')).toBe(false)
    expect(check('0.2.9')).toBe(false)

    // 0.3.0 的破坏性更新（包括其 alpha、rc 和正式版）必须被坚决拦截
    expect(check('0.3.0-alpha.1')).toBe(false)
    expect(check('0.3.0-rc.1')).toBe(false)
    expect(check('0.3.0')).toBe(false)
    expect(check('1.0.0')).toBe(false)
  })

  it('peerDependencies 中的 @deepseek-ai/dsh-* 范围与 engines.dsh 保持一致', () => {
    const dshPeers = Object.entries(pkg.peerDependencies || {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(dshPeers.length).toBeGreaterThan(0)
    for (const [name, range] of dshPeers) {
      expect(range, `${name} peer range 必须对齐精确宿主版本`).toBe(EXACT_DSH)
    }
  })
})
