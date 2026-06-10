import json
import threading
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Set, Tuple


class GraphFraudDetector:
    def __init__(self) -> None:
        self.project_root = Path(__file__).resolve().parents[2]
        self.state_file = self.project_root / "data" / "graph_state.json"
        self.persist_every = 5
        self.edge_counts = defaultdict(Counter)
        self.reverse_edges = defaultdict(set)
        self.node_risk_counts = Counter()
        self.record_count = 0
        self.lock = threading.Lock()
        self._load_state()

    def _load_state(self) -> None:
        try:
            if not self.state_file.exists():
                return
            payload = json.loads(self.state_file.read_text(encoding="utf-8"))
            self.edge_counts = defaultdict(Counter, {source: Counter(targets) for source, targets in payload.get("edge_counts", {}).items()})
            self.reverse_edges = defaultdict(set, {target: set(sources) for target, sources in payload.get("reverse_edges", {}).items()})
            self.node_risk_counts = Counter(payload.get("node_risk_counts", {}))
            self.record_count = int(payload.get("record_count", 0))
        except Exception:
            self.edge_counts = defaultdict(Counter)
            self.reverse_edges = defaultdict(set)
            self.node_risk_counts = Counter()
            self.record_count = 0

    def _persist_state(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "edge_counts": {source: dict(targets) for source, targets in self.edge_counts.items()},
            "reverse_edges": {target: sorted(sources) for target, sources in self.reverse_edges.items()},
            "node_risk_counts": dict(self.node_risk_counts),
            "record_count": self.record_count,
        }
        self.state_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _resolve_nodes(self, tx: Dict[str, Any], client_id: str) -> Tuple[str, str]:
        source = str(
            tx.get("source_account")
            or tx.get("nameOrig")
            or f"user:{client_id}"
        )
        destination = str(
            tx.get("destination_account")
            or tx.get("nameDest")
            or f"merchant:{str(tx.get('type', 'unknown')).lower()}:{int(float(tx.get('amount', 0) or 0) // 500)}"
        )
        return source, destination

    def evaluate(self, tx: Dict[str, Any], client_id: str) -> Dict[str, Any]:
        source, destination = self._resolve_nodes(tx, client_id)
        direct_count = int(self.edge_counts[source][destination])
        reverse_direct = source in self.edge_counts.get(destination, {})
        second_hop_nodes: Set[str] = set(self.edge_counts.get(destination, {}).keys())
        third_hop_cycle = any(source in self.edge_counts.get(node, {}) for node in second_hop_nodes)
        ring_detected = reverse_direct or third_hop_cycle
        destination_in_degree = len(self.reverse_edges.get(destination, set()))
        source_out_degree = len(self.edge_counts.get(source, {}))
        destination_out_degree = len(self.edge_counts.get(destination, {}))
        hub_flag = source_out_degree >= 5 or destination_in_degree >= 5
        mule_flag = destination_in_degree >= 3 and destination_out_degree >= 2
        shared_counterparties = len(second_hop_nodes.intersection(set(self.edge_counts.get(source, {}).keys())))
        burst_cluster_flag = direct_count >= 3 and destination_in_degree >= 2
        prior_risk_hits = int(self.node_risk_counts[source] + self.node_risk_counts[destination])
        destination_repeat_rate = round(direct_count / max(destination_in_degree, 1), 4)
        source_repeat_rate = round(direct_count / max(source_out_degree, 1), 4)
        bridge_flag = destination_in_degree >= 2 and source_out_degree >= 2 and shared_counterparties >= 1

        graph_score = min(
            1.0,
            (0.15 * min(direct_count, 3))
            + (0.35 if ring_detected else 0.0)
            + (0.20 if hub_flag else 0.0)
            + (0.10 if mule_flag else 0.0)
            + (0.10 if burst_cluster_flag else 0.0)
            + (0.10 if bridge_flag else 0.0)
            + (0.05 * min(shared_counterparties, 3))
            + (0.05 * min(prior_risk_hits, 4)),
        )

        return {
            "source_account": source,
            "destination_account": destination,
            "graph_score": round(graph_score, 4),
            "ring_detected": ring_detected,
            "triangle_cycle_detected": third_hop_cycle,
            "hub_flag": hub_flag,
            "mule_flag": mule_flag,
            "burst_cluster_flag": burst_cluster_flag,
            "suspicious_connection_count": direct_count,
            "shared_counterparties": shared_counterparties,
            "source_out_degree": source_out_degree,
            "destination_in_degree": destination_in_degree,
            "bridge_flag": bridge_flag,
            "destination_repeat_rate": destination_repeat_rate,
            "source_repeat_rate": source_repeat_rate,
            "prior_risk_hits": prior_risk_hits,
        }

    def record(self, tx: Dict[str, Any], client_id: str, risk_level: str) -> None:
        with self.lock:
            source, destination = self._resolve_nodes(tx, client_id)
            self.edge_counts[source][destination] += 1
            self.reverse_edges[destination].add(source)

            if str(risk_level).upper() == "HIGH":
                self.node_risk_counts[source] += 1
                self.node_risk_counts[destination] += 1

            self.record_count += 1
            if self.record_count % self.persist_every == 0:
                self._persist_state()

    def health(self) -> Dict[str, Any]:
        return {
            "nodes": len({*self.edge_counts.keys(), *self.reverse_edges.keys()}),
            "edges": sum(sum(counter.values()) for counter in self.edge_counts.values()),
            "high_risk_node_marks": sum(self.node_risk_counts.values()),
            "record_count": self.record_count,
            "state_file": str(self.state_file),
            "state_persisted": self.state_file.exists(),
        }


graph_detector = GraphFraudDetector()
