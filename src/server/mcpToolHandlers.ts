import {
  SQL_TABLES,
  GITHUB_PRS,
  SLACK_THREADS,
  JIRA_TICKETS,
  INTERNAL_DOCS,
  POD_TELEMETRY,
  JiraTicket
} from './sandboxData.ts';
import { RBACRole } from './mcpTypes.ts';

export function dispatchMCPToolHandler(
  toolName: string,
  args: Record<string, any>,
  callerRole: RBACRole
): Record<string, any> {
  switch (toolName) {
    case 'sql_execute_readonly_query': {
      const q = String(args.query).toLowerCase();
      const limit = Number(args.row_limit || 25);
      const matchedTable =
        Object.values(SQL_TABLES).find((t) => q.includes(t.tableName)) || SQL_TABLES.deployments;
      let rows = [...matchedTable.rows];
      if (q.includes('checkout-ledger-svc')) {
        rows = rows.filter((r) => !r.service || r.service === 'checkout-ledger-svc');
      } else if (q.includes('webhook-dispatcher-v2')) {
        rows = rows.filter((r) => !r.service || r.service === 'webhook-dispatcher-v2');
      }
      return {
        table: matchedTable.tableName,
        rowCount: rows.slice(0, limit).length,
        rows: rows.slice(0, limit),
        replicaNode: 'pg-ledger-ro-02.us-east-1',
        readOnlyVerified: true
      };
    }

    case 'sql_inspect_table_schema': {
      const tbl = SQL_TABLES[args.table_name];
      return tbl
        ? { tableName: tbl.tableName, description: tbl.description, columns: tbl.columns }
        : { error: 'Table not found' };
    }

    case 'sql_explain_query_plan': {
      const hasForUpdate = /FOR\s+UPDATE/i.test(String(args.query));
      return {
        Plan: {
          Node_Type: hasForUpdate ? 'LockRows (Exclusive Row Lock)' : 'Index Scan',
          Strategy: hasForUpdate
            ? 'Seq Scan without SKIP LOCKED — HIGH CONTENTION RISK'
            : 'B-Tree Index Cond',
          Estimated_Cost: hasForUpdate ? 18420.5 : 14.2,
          Advisory_Warning: hasForUpdate
            ? 'Unbounded FOR UPDATE detected; causes PgBouncer pool saturation under canary traffic.'
            : 'Query plan is optimal for read replica execution.'
        }
      };
    }

    case 'sql_sample_recent_rows': {
      const tbl = SQL_TABLES[args.table_name] || SQL_TABLES.deployments;
      const lim = Number(args.limit || 10);
      return {
        tableName: tbl.tableName,
        sampleSize: Math.min(lim, tbl.rows.length),
        rows: tbl.rows.slice(0, lim)
      };
    }

    case 'sql_check_replication_lag': {
      const rows = SQL_TABLES.db_replication_status.rows.filter((r) =>
        r.cluster.toLowerCase().includes(String(args.cluster_name).toLowerCase())
      );
      return {
        cluster: args.cluster_name,
        nodes: rows.length > 0 ? rows : SQL_TABLES.db_replication_status.rows
      };
    }

    case 'github_get_pr_diff': {
      const pr = GITHUB_PRS.find((p) => p.pr_number === Number(args.pr_number)) || GITHUB_PRS[0];
      return {
        pr_number: pr.pr_number,
        repo: pr.repo,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        changed_files: pr.changed_files,
        diff_summary: pr.diff_summary
      };
    }

    case 'github_list_pr_checks': {
      const pr = GITHUB_PRS.find((p) => p.pr_number === Number(args.pr_number)) || GITHUB_PRS[0];
      return { pr_number: pr.pr_number, ci_status: pr.ci_status, checks: pr.checks };
    }

    case 'github_blame_file_range': {
      const fp = String(args.file_path);
      const isWebhook = fp.toLowerCase().includes('webhook');
      return {
        file_path: fp,
        last_modified_sha: isWebhook ? 'c4190ab' : 'a8f31c9',
        author: isWebhook ? 'arivera' : 'mchen',
        pr_number: isWebhook ? 1835 : 1842,
        annotation: isWebhook
          ? 'Lines 21-25: Reduced tlsHandshakeTimeoutMs from 2500ms to 400ms'
          : 'Lines 84-89: Replaced bounded SELECT with unbounded SELECT ... FOR UPDATE'
      };
    }

    case 'github_search_commits': {
      const q = String(args.query).toLowerCase();
      const matches = GITHUB_PRS.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.repo.toLowerCase().includes(q) ||
          p.diff_summary.toLowerCase().includes(q)
      );
      return {
        query: args.query,
        commits: (matches.length ? matches : GITHUB_PRS).map((p) => ({
          pr_number: p.pr_number,
          repo: p.repo,
          title: p.title,
          author: p.author
        }))
      };
    }

    case 'github_post_pr_review_comment': {
      const pr = GITHUB_PRS.find((p) => p.pr_number === Number(args.pr_number)) || GITHUB_PRS[0];
      const newComment = {
        id: `gh-c-${Date.now().toString().slice(-4)}`,
        author: `monopulse-agent (${callerRole})`,
        body: String(args.comment_body),
        created_at: new Date().toISOString()
      };
      pr.comments.push(newComment);
      return { mutated: true, pr_number: pr.pr_number, comment: newComment };
    }

    case 'slack_fetch_thread_messages': {
      const thread = SLACK_THREADS.find((t) => t.thread_ts === args.thread_ts) || SLACK_THREADS[0];
      return {
        thread_ts: thread.thread_ts,
        channel_name: thread.channel_name,
        topic: thread.topic,
        messages: thread.messages,
        approval_blocks: thread.approval_blocks
      };
    }

    case 'slack_summarize_incident_thread': {
      const thread = SLACK_THREADS.find((t) => t.thread_ts === args.thread_ts) || SLACK_THREADS[0];
      const isLedger = thread.thread_ts.includes('4200');
      return {
        thread_ts: thread.thread_ts,
        channel: thread.channel_name,
        extracted_signals: {
          mentioned_prs: isLedger ? [1842] : [1835],
          mentioned_commits: isLedger ? ['a8f31c9'] : ['c4190ab'],
          linked_jira: isLedger ? 'OPS-4821' : 'OPS-4819',
          affected_tenants: isLedger
            ? ['Acme Global Logistics', 'Kestrel Financial Systems']
            : ['Vanguard BioLabs']
        }
      };
    }

    case 'slack_search_channel_history': {
      const kw = String(args.keyword).toLowerCase();
      const hits = SLACK_THREADS.flatMap((t) =>
        t.messages
          .filter((m) => m.text.toLowerCase().includes(kw))
          .map((m) => ({
            channel: t.channel_name,
            thread_ts: t.thread_ts,
            user: m.user,
            text: m.text
          }))
      );
      return { keyword: args.keyword, matches: hits };
    }

    case 'slack_post_approval_block': {
      const thread = SLACK_THREADS.find((t) => t.thread_ts === args.thread_ts) || SLACK_THREADS[0];
      const block = {
        block_id: `blk-${Date.now().toString().slice(-5)}`,
        event_id: String(args.event_id),
        summary: String(args.summary_markdown),
        status: 'STAGED' as const,
        posted_at: new Date().toISOString()
      };
      thread.approval_blocks.unshift(block);
      return { posted: true, channel: thread.channel_name, thread_ts: thread.thread_ts, block };
    }

    case 'slack_broadcast_resolution': {
      const thread =
        SLACK_THREADS.find((t) => t.channel_name === args.channel_name) || SLACK_THREADS[0];
      const msg = {
        user: `monopulse-agent [approved-by:${callerRole}]`,
        role: callerRole,
        ts: `${Math.floor(Date.now() / 1000)}.009900`,
        text: `[RESOLVED] ${args.resolution_message}`
      };
      thread.messages.push(msg);
      return { mutated: true, channel: thread.channel_name, message: msg };
    }

    case 'jira_get_ticket_context': {
      const ticket =
        JIRA_TICKETS.find((j) => j.key.toUpperCase() === String(args.ticket_key).toUpperCase()) ||
        JIRA_TICKETS[0];
      return { ...ticket };
    }

    case 'jira_search_similar_issues': {
      const svc = String(args.service).toLowerCase();
      const list = JIRA_TICKETS.filter((j) => j.service.toLowerCase().includes(svc));
      return { service: args.service, tickets: list.length ? list : JIRA_TICKETS };
    }

    case 'jira_transition_ticket_status': {
      const ticket =
        JIRA_TICKETS.find((j) => j.key.toUpperCase() === String(args.ticket_key).toUpperCase()) ||
        JIRA_TICKETS[0];
      const previousStatus = ticket.status;
      ticket.status = args.new_status as JiraTicket['status'];
      return {
        mutated: true,
        ticket_key: ticket.key,
        previous_status: previousStatus,
        new_status: ticket.status,
        transitioned_by: callerRole
      };
    }

    case 'jira_assign_oncall_owner': {
      const ticket =
        JIRA_TICKETS.find((j) => j.key.toUpperCase() === String(args.ticket_key).toUpperCase()) ||
        JIRA_TICKETS[0];
      const prev = ticket.assignee;
      ticket.assignee = String(args.assignee);
      return {
        mutated: true,
        ticket_key: ticket.key,
        previous_assignee: prev,
        new_assignee: ticket.assignee
      };
    }

    case 'jira_append_root_cause_field': {
      const ticket =
        JIRA_TICKETS.find((j) => j.key.toUpperCase() === String(args.ticket_key).toUpperCase()) ||
        JIRA_TICKETS[0];
      ticket.root_cause_notes = String(args.root_cause_notes);
      return { mutated: true, ticket_key: ticket.key, root_cause_notes: ticket.root_cause_notes };
    }

    case 'docs_semantic_search': {
      const q = String(args.query).toLowerCase();
      const docs = INTERNAL_DOCS.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.markdown_body.toLowerCase().includes(q) ||
          d.service.toLowerCase().includes(q)
      );
      return {
        query: args.query,
        results: (docs.length ? docs : INTERNAL_DOCS).map((d) => ({
          doc_id: d.doc_id,
          title: d.title,
          service: d.service,
          category: d.category,
          excerpt: d.markdown_body.slice(0, 260)
        }))
      };
    }

    case 'docs_get_runbook_by_service': {
      const doc =
        INTERNAL_DOCS.find(
          (d) => d.service.toLowerCase() === String(args.service).toLowerCase() && d.category === 'Runbook'
        ) || INTERNAL_DOCS[0];
      return { ...doc };
    }

    case 'docs_list_postmortems': {
      return { postmortems: INTERNAL_DOCS.filter((d) => d.category === 'Postmortem') };
    }

    case 'docs_propose_runbook_patch': {
      const doc =
        INTERNAL_DOCS.find((d) => d.doc_id.toUpperCase() === String(args.doc_id).toUpperCase()) ||
        INTERNAL_DOCS[0];
      const patch = {
        id: `patch-${Date.now().toString().slice(-4)}`,
        author: `monopulse-agent (${callerRole})`,
        diff: String(args.patch_markdown),
        status: 'MERGED_INTO_RUNBOOK',
        timestamp: new Date().toISOString()
      };
      doc.proposed_patches.push(patch);
      doc.markdown_body += `\n\n### Automated Guardrail Patch (${patch.id})\n${args.patch_markdown}`;
      return { mutated: true, doc_id: doc.doc_id, patch };
    }

    case 'infra_get_service_error_rate': {
      const svc = POD_TELEMETRY[args.service] || POD_TELEMETRY['checkout-ledger-svc'];
      return {
        service: svc.service,
        error_rate_pct: svc.error_rate_pct,
        p99_latency_ms: svc.p99_latency_ms,
        active_canary_id: svc.active_canary_id
      };
    }

    case 'infra_fetch_pod_logs': {
      const svc = POD_TELEMETRY[args.service] || POD_TELEMETRY['checkout-ledger-svc'];
      return { service: svc.service, recent_logs: svc.recent_logs };
    }

    case 'infra_check_feature_flags': {
      const flags = SQL_TABLES.feature_flags.rows.filter(
        (f) => f.service.toLowerCase() === String(args.service).toLowerCase()
      );
      return {
        service: args.service,
        flags: flags.length ? flags : SQL_TABLES.feature_flags.rows
      };
    }

    case 'infra_trigger_canary_rollback': {
      const depRow = SQL_TABLES.deployments.rows.find((r) => r.deploy_id === args.deploy_id);
      if (depRow) {
        depRow.status = 'ROLLED_BACK';
        depRow.canary_weight_pct = 0;
      }
      const ledgerTelemetry = POD_TELEMETRY['checkout-ledger-svc'];
      ledgerTelemetry.error_rate_pct = 0.18;
      ledgerTelemetry.p99_latency_ms = 94;
      ledgerTelemetry.active_canary_id = null;
      ledgerTelemetry.recent_logs.unshift(
        `${new Date().toISOString()} [INFO] [canary-controller] Rolled back ${args.deploy_id} (${args.reason}). Error rate recovered to 0.18%.`
      );
      return {
        mutated: true,
        deploy_id: args.deploy_id,
        new_status: 'ROLLED_BACK',
        traffic_shifted_to_stable_pct: 100,
        post_rollback_error_rate_pct: 0.18,
        post_rollback_p99_ms: 94
      };
    }

    default:
      return { executed: true, toolName };
  }
}
