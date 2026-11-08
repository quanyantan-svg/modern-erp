// OUT-001 真实 MySQL 8 Gate 的 Root 生命周期。
//
// 它是 M1-Core G07 Root 生命周期的同构实现，但**不复用**它的 Manifest，也不
// 复用被 `blockUnmigratedAck4Entry` 阻断的入口。依赖全部显式注入，因此完整
// 状态机可以在**不打开 MySQL** 的前提下被证明；生产 CLI 只在 ACK-4 被消费
// 之后才提供进程/数据库适配器。
//
// Requirement : document.md §31.14.2
// Design      : docs/design/procurement-outsourcing.md §26.34.15、§26.34.15.3

import {
  assertActiveRootLease, beginAck4RootOperation, finalizeAck4Run,
  issueChildLease, issuePortableChildLease,
} from './ack4/ack4-runtime.mjs';

export const OUT_001_MYSQL_GATE_MANIFEST = 'OUT_001_MYSQL_V1';

export function out001OperationContext(rootLease, operation, registeredChildren) {
  return Object.freeze({
    rootLease,
    operation,
    issueChild({ childPid, childStartedAt }) {
      const lease = issueChildLease(rootLease, { childPid, childStartedAt, operations: [operation] });
      registeredChildren.push({ childPid, childStartedAt, operation, exited: false });
      return lease;
    },
    issuePortableChild({ childPid, childStartedAt }) {
      const lease = issuePortableChildLease(rootLease, { childPid, childStartedAt, operation });
      registeredChildren.push({ childPid, childStartedAt, operation, exited: false });
      return lease;
    },
    markChildExited(childPid, childStartedAt) {
      const child = registeredChildren.find((item) => item.childPid === childPid && item.childStartedAt === childStartedAt);
      if (!child) throw new Error('OUT_001_MYSQL_UNREGISTERED_CHILD_EXIT');
      child.exited = true;
    },
  });
}

/**
 * Root 拥有的生命周期。顺序由 ACK-4 的 `beginAck4RootOperation` 强制：
 * RESET → BOOTSTRAP → RUN_OUT001_HTTP_FIXTURES，CLEANUP_SCHEMA_POST_RUN
 * 只能在子进程全部退出后执行。任何一步失败都会进入 `finally`，尝试清理；
 * 清理无法被证明时由 `finalizeAck4Run` 写入 quarantine 标记。
 */
export async function runOut001MySqlLifecycle({
  consumeRoot, expected, quarantineDir,
  reset, bootstrap, runHttpFixtures, stopChildren, cleanup, verifyCleanup,
}) {
  let rootLease = null;
  let primaryError = null;
  let testsPassed = false;
  let cleanupProven = false;
  let childrenExited = false;
  let cleanupAttempts = 0;
  let inventory = [];
  let resetStarted = false;
  let resetCompleted = false;
  const registeredChildren = [];

  try {
    // 第一个外部动作永远是能力消费：在它解析成功之前，数据库、HTTP fixture
    // 与进程回调都不可达。
    rootLease = await consumeRoot();
    assertActiveRootLease(rootLease, expected);

    beginAck4RootOperation(rootLease, 'RESET_SCHEMA_PRE_RUN', expected);
    resetStarted = true;
    await reset(out001OperationContext(rootLease, 'RESET_SCHEMA_PRE_RUN', registeredChildren));
    resetCompleted = true;

    beginAck4RootOperation(rootLease, 'BOOTSTRAP_CURRENT_SCHEMA', expected);
    await bootstrap(out001OperationContext(rootLease, 'BOOTSTRAP_CURRENT_SCHEMA', registeredChildren));

    beginAck4RootOperation(rootLease, 'RUN_OUT001_HTTP_FIXTURES', expected);
    const result = await runHttpFixtures(out001OperationContext(rootLease, 'RUN_OUT001_HTTP_FIXTURES', registeredChildren));
    testsPassed = result?.passed === true;
    if (!testsPassed) throw new Error('OUT_001_MYSQL_SUITE_DID_NOT_PASS');
  } catch (error) {
    primaryError = error;
  } finally {
    if (rootLease) {
      try {
        const stopped = await stopChildren(Object.freeze([...registeredChildren]));
        childrenExited = stopped === true && registeredChildren.every((child) => child.exited === true);
      } catch (error) {
        primaryError ||= error;
        childrenExited = false;
      }
      if (!childrenExited) {
        inventory = ['CHILD_EXIT_UNVERIFIED'];
        cleanupProven = false;
      } else if (resetStarted && !resetCompleted) {
        // RESET 的结果未知时必须保留现场。此时禁止 Cleanup，避免把并发创建或
        // 未知对象当成本 Gate 的产物删除。
        inventory = ['RESET_UNVERIFIED'];
        cleanupProven = false;
      } else {
        try {
          cleanupAttempts += 1;
          beginAck4RootOperation(rootLease, 'CLEANUP_SCHEMA_POST_RUN', expected);
          await cleanup(out001OperationContext(rootLease, 'CLEANUP_SCHEMA_POST_RUN', registeredChildren));
          const verification = await verifyCleanup();
          inventory = Array.isArray(verification?.inventory) ? verification.inventory : [];
          cleanupProven = verification?.clean === true && inventory.length === 0;
        } catch (error) {
          primaryError ||= error;
          cleanupProven = false;
        }
      }
    }
  }

  if (!rootLease) throw primaryError || new Error('ACK4_ROOT_LEASE_REQUIRED');
  const state = finalizeAck4Run(rootLease, {
    testsPassed, cleanupProven, childrenExited, quarantineDir, inventory,
  });
  const report = Object.freeze({
    runId: rootLease.runId,
    manifest: rootLease.manifest,
    state, testsPassed, cleanupProven, childrenExited,
    cleanupAttempts, childCount: registeredChildren.length,
    resetStarted, resetCompleted,
  });
  if (primaryError) {
    primaryError.out001Lifecycle = report;
    throw primaryError;
  }
  return report;
}
