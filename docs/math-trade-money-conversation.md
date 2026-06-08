# Adding Money to a Math Trade Solver

A discussion on extending a 1-to-1 cycle-cover math trade solver to support cash, the
complexity implications, and how to formulate the money version in a MIP.

---

## 1. Should I add a "money for games" feature?

**Question.** I implemented a math trade solver that does a maximal cycle cover to find
the solution. It also does a heuristic that, after finding a solution, chooses edges from
users that have no trading edges at all, adds a small priority to them, and reruns the
solver — most of the time this finds the maximum number of participating users without
modifying the maximum number of trades in general. I'm wondering if I could add a feature
to offer money for games: a user has a cap of $X$ money, specifies they'd pay at most $Y$
to receive some game, while other users say they want at least $Z$ to send their game.
It's possible a flow solution doesn't suffice and it becomes an NP problem; in that case a
heuristic would suffice. I have a general MIP solver that solves the harder N-to-M version
and can solve this money version too, but it's very slow — I'm only trying to enhance the
1-to-1 solver.

**Answer.**

The complexity hinges almost entirely on one thing: the per-user budget cap. Everything
else can live inside a min-cost flow.

### Why budgets are the dividing line

Strip the budget out — keep only per-(buyer, game) bids $Y$ and per-(seller, game) asks
$Z$, with cash coming from outside the system — and the money version is *still* an
assignment / min-cost-flow problem, so it stays polynomial. Cash doesn't break the
cycle-cover structure because a cash sale consumes exactly the same two resources an item
move does: game $g$'s "given" slot and its "received" slot. The seller gives $g$ and takes
cash (no receive slot used); the buyer takes $g$ and pays cash (no give slot used). So a
sale is just an alternative way to fill $g$'s own two slots — structurally a self-edge
$L_g \to R_g$ — carrying a value equal to the surplus $(Y - Z)$, instead of $g$ flowing
through a cycle. Nothing couples one game's sale to another's, so each game independently
picks its best option (keep / cycle / sell), which is precisely what the matching already
does.

Concretely, to bolt this onto the existing solver: for every game $g$, alongside its
want-list out-edges and its low-priority keep-self-edge, add parallel "sold" edges
$L_g \to R_g$, one per willing buyer $b$ with $Y(b,g) \ge Z(g)$, each with a cost encoding
that buyer's surplus/priority. Min-cost flow selects the best buyer automatically and
leaves $g$ in a cycle whenever that's worth more. A buyer who also trades their own games
in cycles is unaffected — different item slots. Even cash *adjustments inside* a cycle
("my A for your B plus $10") are fine without budgets: the side payment just shifts that
edge's weight. So without hard caps (or with caps loose enough never to bind), you get the
whole feature essentially for free in the 1-to-1 solver.

### Why budgets make it NP-hard

A budget $X$ is a single resource shared across all of one buyer's purchases, and each
purchase consumes a variable amount of it (the price) while contributing a value decoupled
from that amount (a trade, or surplus). That's a knapsack constraint sitting on top of the
flow — formally a min-cost flow with side resource constraints, which is NP-hard even
though plain min-cost flow is in P.

The reduction is immediate: one buyer, budget $X$, sellers offering games at fixed prices
$w_i$ (set $Y = Z = w_i$ so the price is forced), value $v_i$ per completed sale →
maximize value subject to $\sum w_i \le X$ is exactly Knapsack. Multiple budget-constrained
buyers over overlapping games is Generalized Assignment / multiple-knapsack, and even the
pure "maximize number of cash trades" objective is hard there (it encodes bin-packing /
3-partition). So the instinct is right: flow alone won't capture it, and a heuristic is the
pragmatic route, with the MIP as the slow exact fallback.

One fork worth stating explicitly: this assumes *external* cash — buyers bring their own
money and the system needn't net to zero. If money is instead closed/internal (you can only
spend what you earn selling), that couples each user's buys to their sells and is likewise
hard. The genuinely easy case is external cash with no binding per-user cap.

### A special case that stays polynomial

If you cap each user to at most one cash purchase (unit demand on the buy side), the budget
degenerates into a per-edge feasibility filter — does this single purchase fit? — with no
cross-purchase coupling, and the whole thing is back to an assignment problem. "You may buy
into at most one game with cash" might be an acceptable product rule that sidesteps the
hardness entirely.

### Heuristics that reuse the flow solver

Since the budgeted problem is "a flow you can already solve, plus a few knapsack side
constraints," the natural heuristics keep the flow at the core:

- **Lagrangian relaxation of the budgets.** Add a penalty $\lambda_b \cdot \text{price}$ to
  each of buyer $b$'s purchase edges, solve the now-pure min-cost flow, then adjust
  $\lambda_b$ by subgradient (raise it for buyers who overspent, lower it for those with
  slack) and repeat. Each iteration is one fast flow solve, it yields a dual bound to gauge
  quality, and it usually lands near-feasible; a light repair finishes it.
- **Greedy repair.** Solve the no-budget flow; for any over-budget buyer, drop their
  lowest-value purchases (smallest surplus per dollar) until they fit, release those games,
  and rerun the flow on the residual so freed games re-home to other buyers or back into
  cycles. Iterate to a fixpoint. This is basically the existing "perturb priorities and
  rerun" loop with a budget-aware drop step.

Lagrangian tends to give better solutions plus a bound; greedy repair is simpler and
closest to what's already there.

### Modeling caveats

You'll need a price rule, since bid > ask leaves surplus to split — pay-your-bid,
pay-the-ask, and split-the-difference all work and don't change complexity, but they shift
incentives and the edge weights. Decide how cash deals enter the lexicographic objective:
likely both buyer and seller count as participants and a sale counts as a trade, but weight
cash edges so the optimizer doesn't prefer a swarm of tiny cash deals over real item
cycles. And re-tune the lonely-user heuristic to recognize the new ways someone can
participate — as a buyer or seller, not only via a cycle.

---

## 2. The MIP formulation

**Decision.** I'll only implement this in the MIP solver version.

### Sets and Parameters

- $U$: the set of all participating users.
- $I$: the set of all games in the trade.
- $X_u$: the absolute maximum cash budget user $u$ is allowed to spend.
- $Y_{u,i}$: the maximum cash user $u$ is willing to pay to receive game $i$.
- $Z_i$: the minimum cash the original owner of game $i$ demands to trade it away.

### Decision Variables

- $x_{u,i} \in \{0,1\}$: 1 if user $u$ receives game $i$, else 0.
- $p_{u,i} \ge 0$: continuous, the exact cash user $u$ pays for game $i$. Continuous (not
  integer) keeps the solver from branching on dollar amounts, which is much faster.

### Constraints

**1. Item conservation** — a game goes to at most one person:
$$\sum_{u \in U} x_{u,i} \le 1 \quad \forall i \in I$$

**2. Maximum willingness to pay (buyer edge)** — can't pay more than $Y$, and pays 0 if not
received:
$$p_{u,i} \le Y_{u,i} \cdot x_{u,i} \quad \forall u \in U, \forall i \in I$$

**3. Minimum willingness to accept (seller edge)** — if game $i$ moves to anyone, total cash
paid for it meets the owner's floor:
$$\sum_{u \in U} p_{u,i} \ge Z_i \cdot \sum_{u \in U} x_{u,i} \quad \forall i \in I$$

**4. User budget cap** — total cash a user pays across all received games stays under budget:
$$\sum_{i \in I} p_{u,i} \le X_u \quad \forall u \in U$$

**Net spending variant** — let users fund purchases with sale proceeds. With $O_u \subseteq I$
the games user $u$ originally owns:
$$\sum_{i \in I} p_{u,i} - \sum_{j \in O_u}\sum_{v \in U} p_{v,j} \le X_u \quad \forall u \in U$$

**Answer / corrections.**

The four constraints are individually sound. As a feasibility model for *external* cash —
buyers bring money, sellers get paid, payment for item $i$ routes to item $i$'s owner —
they're correct. Constraint 2's $p \le Y\cdot x$ is the standard big-M-free linking trick
that doubles as "no payment without receipt," and the continuous-$p$ observation is right.

But the explanation of *why* chains form is wrong, and fixing it matters when reading solver
output.

**The Catan / Ticket-to-Ride trace doesn't hold.** With A receiving Catan and
$p_{A,Catan}=15$, the only place that \$15 enters on the seller side is constraint 3 *for
Catan*:
$$\sum_u p_{u,Catan} = p_{A,Catan} = 15 \ge Z_{Catan}$$
So it satisfies *Catan's* floor — it pays Catan's owner. It never appears in constraint 3
for Ticket to Ride, which contains only payments tagged to TtR. Since $p$ is indexed by the
game *received*, cash for item $i$ is structurally bound to item $i$'s own $Z$. There's no
per-item pooling letting one item's payment cover another item's ask.

**What actually creates the pass-through is the net-budget constraint, not constraint 3.**
The real chain is "A pays O for Catan; O pays Q for TtR," with O (Catan's owner, who wanted a
game) as a cash pass-through: A is the net source, Q the net sink, O swaps items and nets
zero. For O to forward A's \$15, O's sale proceeds must fund O's purchase — exactly what
$$\sum_i p_{O,i} - \sum_{j\in O_O}\sum_v p_{v,j} \le X_O$$
permits ($15 - 15 \le X_O$, fine at $X_O=0$). Under the *simple* budget, O's earnings aren't
credited, so O would need their own cash and the chain does **not** form for free. So the
"automatic chain" property holds only under the net-budget version, and the mechanism is
per-user netting, not per-item $Z$ matching.

**The price is underdetermined.** For any executed trade, constraints 2 and 3 pin $p_{u,i}$
only to $[Z_i,\ Y_{u,i}]$. Nothing selects a point, so without an objective term on $p$ the
solver returns an arbitrary feasible split — two runs can hand surplus to different parties.
And it's not locally free: price feeds the budget constraints, so a high price on one leg
eats more of a buyer's cap (or hands a seller more proceeds to re-spend), meaning one
trade's split can flip another's feasibility. Commit to a pricing rule — pay-your-bid
($p=Y$), pay-the-ask ($p=Z$), or split — and encode it as a small term at the bottom of the
lexicographic objective. No complexity change; it just makes dollars deterministic.

Three smaller things:

- **No objective is shown.** The lexicographic goal (max trades, then participants) still
  must be stated, now counting cash buyers/sellers as participants, weighted so tiny cash
  sales don't outrank real cycles, with the pricing tie-breaker beneath it.
- **$Z_i$ is charged even on pure swaps.** Constraint 3 fires whenever $i$ moves to anyone,
  so an owner happy to swap still collects $Z$. $Z$ can't express "free if I get a good item
  back, otherwise \$30" without an extra "received an item?" indicator gating the $Z$ term.
- **Continuous prices settle fractionally.** Round at the end against currency granularity
  and re-check $Z$, $Y$, $X$. Scaling to integer cents (in the data) while keeping $p$
  continuous usually removes the artifacts.

---

## 3. Pricing rule: pay-your-bid vs pay-the-ask

**Question.** I believe paying the bid is better as it punishes greedy behavior and leaves
more cash room for more trades. I'm not sure integer cents is correct for speed — it's okay
to miss by a few cents due to rounding.

**Answer.**

**"More cash room for more trades" is backwards.** Money is conserved on every edge — each
dollar a buyer pays is a dollar a seller receives — so the pricing rule never changes how
much cash exists, only who holds it.

Under the **simple budget** (seller proceeds not credited), only buyer spending counts
against any cap. Pay-your-bid *maximizes* buyer spending, making every budget constraint as
tight as possible → weakly *fewer* feasible trades. If room-for-trades were the goal under
simple budgets, you'd want pay-the-ask — the opposite.

Under **net budgets**, price is pure redistribution: pushing prices up moves cash from
buyers toward sellers, which helps only when the binding constraint is a seller needing
proceeds to fund an onward purchase, and hurts when it's a terminal buyer. Instance-dependent.

**Implementation catch:** do not encode pay-your-bid as a hard $p = Y$. That removes the
slack the solver uses to fit trades under budgets — any allocation needing a buyer to pay
*below* their bid to stay solvent becomes infeasible, and trade count can drop. Pay-your-bid
must sit strictly *below* trade and participant count in the lexicographic order, as a
tie-breaker: maximize trades with $p$ free in $[Z,Y]$, then maximize $\sum p$. Even then it's
only fully determined when budgets don't bind.

On "punishes greedy behavior": the grain of truth is that pay-your-bid kills costless
over-bidding (under pay-the-ask, post $Y=\$1000$ to dominate and pay only $Z=\$5$). But
pay-your-bid is a first-price rule and induces the opposite distortion — bid shading below
true value — and under-reported $Y$ shrinks the match set. No rule here is truthful
(budget-balanced + efficient + strategy-proof is impossible for such an exchange), so
pay-your-bid is defensible, just don't expect it to discipline strategy or grow trade count.

**Cents — integer data vs integer variables.** Integer *p* (a variable) forces branching on
dollar amounts and is slow — correctly avoided. "Scale to integer cents" meant the *data*
($Y, Z, X$), which adds no variables and no slowdown, but on its own doesn't make $p$
integer. What gives whole-cent prices is the combination with a pricing rule: once $x$ is
fixed, pricing is a small transportation-style LP (buyer→item edges, floors $Z$, caps $X$);
with integer-cent data that bipartite structure has integral vertices, so a vertex/crossover
solution returns whole-cent prices with no integer variables. Take a vertex solution rather
than an interior point. If rounding, round *directionally* so it fails safe: never round a
payment down through $Z$, never round a buyer up past $X$.

---

## 4. Settling on pay-the-ask

**Decision.** I'll pay the ask. Any extra considerations before formulating the MIP?

**Answer.**

Pay-the-ask is right for a trade-count-first objective — cleanly under *simple* budgets. The
reason isn't that it creates room (money is still conserved); it consumes *less budget per
trade* (charge $Z$, not $Y$), so fewer budget constraints bind and weakly more trades clear.
Own the asymmetry: $Y$ now only *gates* participation (need $Y \ge Z$ to qualify), price is
always the seller's floor, and all surplus goes to the buyer. A hot game with five bidders
still sells for exactly $Z$ — a deliberate, often-desired anti-profiteering norm.

**The payoff: pay-the-ask lets you delete the continuous price variables entirely.** Since
the price on any executed edge is the constant $Z_i$, substitute $p_{u,i} = Z_i \cdot x_{u,i}$
everywhere:

- Constraint 2 → $Z_i \le Y_{u,i}$ per edge — a static pre-filter. Drop every $(u,i)$ where
  the bid doesn't clear the ask. No variable, no constraint.
- Constraint 3 → $Z_i \sum x \ge Z_i \sum x$ — vacuous, gone.
- Constraint 4 → $\sum_i Z_i x_{u,i} \le X_u$ — a pure binary knapsack on $x$. Net budget
  likewise stays linear in $x$ with constant $Z$ coefficients.

You're left with a pure binary program in $x$ alone: no continuous block, no linking
constraints, no pricing objective term, and the fractional-cent and price-nondeterminism
worries vanish. That's why pay-the-ask is easier to *implement*, separate from fairness.

Still unspecified:

- **The objective.** Needs no price term now. Decide semantics: does a "trade" count
  item-moves or satisfied users; does a cash sale count like a swap; do cash-only
  buyers/sellers count as participants. Implement max-trades-then-max-participants via the
  solver's native hierarchical/multi-objective feature (Gurobi, CPLEX), not hand-tuned
  big-M weights — the ratios for strict lexicographic priority wreck numerics. Allocation
  ties stay nondeterministic even though price no longer is; add a deterministic tie-break
  if reproducibility matters.
- **Per-user structure.** Force $x_{u,i}=0$ for $u=\text{owner}(i)$. In N-to-M, 1-1 balance
  isn't automatic; decide whether pure cash buyers/sellers are allowed or whether receiving
  requires giving or paying. Right now receipt is gated only by budget, letting a user buy
  their whole want-list.
- **Whether $Z$ applies to swaps.** If an owner collects $Z$ whenever their item leaves
  (even a cashless swap), the substitution stays clean. If true swaps should be free with
  $Z$ only on cash sales, gate $Z$ with a "received no item back" indicator — which
  reintroduces a binary and partially un-collapses the model. The easy formulation quietly
  assumes unconditional asks.

On speed, the highest-leverage move is to decompose by connected component before invoking
the MIP: items/users untouched by any cash bid form subproblems the fast cycle-cover solver
handles, and only the money-linked component(s) need the MIP. A cashless solution can also
seed a MIP start, but under pay-the-ask a previously-free swap now costs $Z$, so the seed
may need budget repair first.

---

## 5. Warm starting and decomposition

**Note.** The objective is to maximize the number of trades. There are no cash-only
participants — every user has games and buying/selling prices. The fast solver can't solve a
component without money because it'll also have N-to-M trades, but that part could be warm
started by solving 1-to-1 with the solver.

**Answer.**

The warm start is valid and cheap, but be precise about what it buys. A MIP start is a
primal incumbent seed: it gives a feasible floor early and prunes nodes whose relaxation
bound falls below it. It does *not* tighten the relaxation or carry a search tree. So
diagnose where the slow solve spends time:

- Slow to reach a *first good solution* → the seed helps.
- Finds a solution fast then grinds *closing the gap to prove optimality* → the seed does
  nothing; gap-closing is a bound problem (cover cuts on the budget knapsacks, symmetry
  breaking for duplicate copies of a game, tighter formulation).

Solvers also run their own primal heuristics that often find an incumbent in seconds, so the
seed wins most when feasible points are genuinely hard to reach — which budget-constrained
bundle packing can make true. Check the gap trace first.

**Bigger catch: a 1-1 cycle-cover solution is not automatically feasible for the
N-to-M+money model, and an infeasible MIP start gets silently discarded.** Two failure modes:

- **Bundle atomicity.** If a user offered {A,B} atomically, the cycle cover — seeing
  independent item edges — can rehome A but not B, executing half a bundle the real model
  forbids.
- **Budget under pay-the-ask.** If $Z$ is charged on every item move (clean-collapse
  version), a swap that was free in the cashless cover now costs the receiver $Z$ and can
  bust budgets. If $Z$ applies only to cash sales, the seed is budget-trivially feasible but
  the model no longer collapses to pure binary. Resolving this fork decides whether the seed
  is feasible out of the box.

So the seed needs a repair pass — drop partial bundles, drop budget-overrunning trades —
before handoff, and confirm the solver accepted it.

**Decomposition.** Right to push back: cashless doesn't mean fast-solvable, because N-to-M
bundling is NP-hard on its own. So the fast solver isn't a component solver here — it's the
warm-start generator. But component decomposition still pays, because several small
independent MIPs beat one large MIP super-linearly. Split on the *full* coupling graph —
items share a component if any want-list edge, cash bid, bundle, or shared budget links them
— and seed each piece from its own 1-1 cover. Caveat: under net budgets the budget links
every item a user owns to every item they might buy, fusing components into one; simple
budgets only link items competing for the same buyer's cap. Decomposition buys more under
simple budgets.

**Objective.** "Maximize trades" under N-to-M is cleanest as $\max \sum x_{u,i}$ — items
rehomed, each counted once — with bundle atomicity as a *constraint* alongside, not an
objective term. Since everyone owns games and bids, every node is buyer, seller, and swapper
at once, so no participant term and no special-casing of pure buyers is needed — just the
standard "don't sell a user their own item" ($x=0$ for the owner), and the model's
well-posed.
