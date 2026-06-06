Create a modern web platform inspired by the classic “On-Line Want List Generator (OLWLG)” for board game math trades, but redesigned from the ground up for scalability, usability, transparency, and advanced trade flexibility.

The platform’s core purpose is to organize large multi-user board game trade events where users submit games they own and games they want, and the system computes optimal trade cycles.

The new platform must support BOTH:

Traditional 1-to-1 trading
Advanced M-to-N trading using user-defined groups of games

The system should be designed for convention-scale events with many of users and thousands of listed games. The algorithmic solver is already implemented somewhere else so the output format will be defined later down the road. Build the backend with Django.

Users upload physical copies of board games they own and are willing to trade. Each uploaded copy is a distinct item instance with its own metadata: condition, language, edition, missing components, upgraded components, photos, notes, etc

However, browsing should primarily occur at the BOARD GAME level rather than at the individual copy level. Game metadata should be synchronized with BoardGameGeek. Current API access requires authentication but we can use the list of games at boardgames_ranks.csv, and leave API features for the future.

The UI should group all user listings under the canonical BoardGameGeek game entry. For example:

Root game page: “Brass: Birmingham”
Under it:
User A’s copy (excellent condition)
User B’s copy (Spanish edition)
User C’s copy (with upgraded tokens)
etc.

This allows discovery at the game level while still preserving detailed per-copy information.

Main Functional Requirements:
1. User Accounts
Users can: register/login, create profiles, link BoardGameGeek usernames, import collections from BoardGameGeek, track trade history, rate completed trades, block users, create wishlists, opt into specific trade events. Support OAuth login, email/password login.

2. Trade Events
The platform revolves around “Trade Events”. Each event has: name, description, organizer, deadlines, event status, shipping rules, regional restrictions, trade policies, algorithm settings.

Lifecycle:
Open for submissions
Open for want list editing
Matching computation
Match review
Finalization
Shipping/trade completion
Archive

3. Canonical Game Pages

Games are indexed by BoardGameGeek IDs.
Each canonical game page should include: title, image, year, designers, publishers, player counts, playtime, ratings, rankings, expansions, categories, mechanics

Full data will be synced in the future from BoardGameGeek API (when we get authorization).

4. Individual User Copies

Users upload “copies” of games.
Each copy contains condition grading, edition, language, sleeve status, expansion inclusion, component notes, photos, shipping constraints, trade value hints, pickup availability, owner notes. Each copy has a unique listing ID independent from the BGG game ID.

5. Traditional 1-to-1 Trades

Support the classic OLWLG style:
User offers Item A
User wants Item B

6. M-to-N Group Trading (Major Feature)

This is the major innovation. Users can define OFFER GROUPS. An offer group contains a set of owned games a maximum number M of games willing to give optional internal rules.

Example:
Group: Catan, Azul. Pandemic
User says: “Willing to trade ANY UP TO 2 games from this group”

Both 1-to-1 and M-to-N types of trades can be classified under the same term, X-to-Y trades, that go from some offer group (composed of owned games from that wishing user) to some want group (made out of other users' games). This way the groups aren't forced to have X and Y items, for example we can represent many 1-to-1 trades like

Catan -> Azul Pandemic Gloomhaven
Willing to trade at most X=1 games (catan) for at least Y=1 games (Azul, Pandemic or Gloomhaven)

So we use a "1-to-1" representation with multiple games to group up multiple wishes, and we can use the same representation for the other M-to-N wishes, doing the representation (OFFER GROUP) -> (WANT GROUP) (X-to-Y)

7. Game-Centric Browsing

Browsing should focus on canonical games first.

Example UI flow:
Search “Spirit Island”
Open canonical game page
See all available user copies

Filter by condition, language, name.

8. Want List Builder
Provide drag-and-drop priority lists, tiered wants, bulk editing, import/export, duplicate handling.

9. Technical Stack
Include recomendations for frontend, async jobs and caching. Backend django preferred.)Database SQLite as the first version.

The system must support:
real-time UI updates
asynchronous optimization jobs

10. API Design
Provide REST API design, authentication flows, event/websocket updates, pagination strategy, filtering strategy.

11. Database Design
Design schemas for users, canonical games, user copies, trade events, wants, offer groups, trade cycles.

12. Mobile Experience
The platform must be responsive and work well on desktop, tablets, phones.
Prioritize fast searching, easy want list editing, intuitive bundle management.

13. Visualizations
Include ideas for trade graph visualization, cycle visualization, bundle diagrams.

14. Deliverables Requested

Generate:

Full product specification
System architecture
Database schema proposal
API specification
UI/UX wireframe descriptions
Scalability considerations
Security considerations
Recommended tech stack
Example workflows
Example data models
Example matching scenarios
Migration strategy from classic OLWLG systems

The final design should feel like:

modern
scalable
transparent
optimized for large community trading events
friendly to both casual users and power traders