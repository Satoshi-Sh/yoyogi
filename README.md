# Yoyogi

## Get a token
1. Log into your Mastodon instance
2. Click on "Preferences" --> "Development" --> "New application".
3. Type in whatever you want for "Application name", and uncheck `write` ❌ and `follow` ❌, so the only thing you have checked is `read` ✅.
4. Click "Submit"
5. Go to the application you just created, and copy the *access token*, which today is the third long string of random characters.

## Test your token
First, let's set up some environment variables so I can write this document without leaking my info.
```bash
export TOKEN=INSERT_YOUR_TOKEN_HERE__CAREFUL_WITH_SPACES_AROUND_EQUAL_SIGN
export MASTODON="https://octodon.social"
```
Adjust the two values accordingly. Make sure you don't have spaces around the `=`.

Now!
```bash
curl -H "Authorization: Bearer $TOKEN" $MASTODON/api/v1/accounts/verify_credentials
```

If everything is good, this should print out a bunch of JSON-encoded information about your account. 🥳

If something is bad, e.g., if you omit the token or use an invalid token:
```bash
curl $MASTODON/api/v1/accounts/verify_credentials
```
you'll get something like
```json
{"error":"This method requires an authenticated user"}
```

(You might also get some other errors if your account is suspended, etc., see https://docs.joinmastodon.org/methods/accounts/ --> "Verify account credentials")

## Get your account ID
Do you have jq? If you do, this is easy: run the same curl command above and pipe it to jq to get your account ID:
```bash
curl -q -H "Authorization: Bearer $TOKEN" $MASTODON/api/v1/accounts/verify_credentials | jq -r '.id'
```
This should print a numeric ID.

If you don't have jq, just look at response the server sent you, the `id` should be the first thing it sent you.

Save that ID in another environment variable. If you have jq,
```bash
export MASTODON_ID=`curl -q -H "Authorization: Bearer $TOKEN" $MASTODON/api/v1/accounts/verify_credentials | jq -r '.id'`
```
Otherwise just
```bash
export MASTODON_ID=YOUR_ID_HERE
```

## Get a list of your follows
We're going to use all three of our environment variables to get this. Even if you follow a reasonable number of people, this is going to be a ton of data so I add the `-O` flag below to tell curl to save the server's JSON reply to a file called `following`:
```bash
curl -H "Authorization: Bearer $TOKEN" $MASTODON/api/v1/accounts/$MASTODON_ID/following -O
```

If you have jq, here's a command that'll print out the URLs and IDs of all your follows:
```bash
cat following | jq '.[] | {url: .url, id: .id}'
```

Lucky for us, this ID lets our home instance find other users even if they're from other instances! The next command will show you the account info of the last person you followed (the first person listed in the `following` file), assuming you have jq:
```bash
curl -H "Authorization: Bearer $TOKEN" $MASTODON/api/v1/accounts/`cat following | jq -r '.[0].id'` | jq '.'
```

> Reading https://docs.joinmastodon.org/methods/accounts/ I kind of expected this to work without the token but my home instance insists I have a token (i.e., it knows who I am) before it'll even give me basic public info about a person.

## Get a list of someone's toots
For simplicity/narcissism, we'll look at our own statuses (toots). This downloads your own most recent toots (including DM's!) and saves a file called `statuses`.
```bash
curl -H "Authorization: Bearer $TOKEN" $MASTODON/api/v1/accounts/$MASTODON_ID/statuses -O
```

This will return an array of toots (replies, boosts, DMs if you're authorized to see them, etc.) in time order.

## Convert a status to its ancestors and descendants
The way toots work is, each toot can have only one (or no) parent, but it can have any number of children. Given we get a list of toots most-recent-first, for each of them we'll want to find all their ancestor toots, up to the the oldest ancestor (the progenitor).

One useful thing might be—each toot has a `in_reply_to_id`, which gives us the *parent toot ID* of this toot. It'll be either some long number or `null`, meaning this toot is a progenitor toot:
```bash
cat statuses | jq '.[].in_reply_to_id'
```
This will hopefully print a mix of numbers and `null`s.

Let's get first `in_reply_to_id` we have, and ask Mastodon for all of that parent toot's ancestors and descendants. First, set up an environment variable for that status ID:
```bash
export STATUS_ID=`cat statuses | jq -r '.[].in_reply_to_id' | grep -v null | head -n1`
```
If you don't have jq or if you don't see any replies in your list of `statuses`, just run instead `export STATUS_ID=SOME_STATUS_ID`.

Now we can ask the server for that status ID's context, saving the reply to a file called `context`:
```bash
curl -H "Authorization: Bearer $TOKEN" $MASTODON/api/v1/statuses/$STATUS_ID/context -O
```
The server returns two lists of statuses:
- `ancestors` and
- `descendants`.

The `ancestors` array is the direct chain all the way up from `STATUS_ID` to the progenitor toot. The earliest toot comes first. Similarly, `descendants` includes all children, grandchildren, and descendents, also in earliest first. In either case, there will be toots from you and from others (depending on whether you replied to someone or others replied to you). It's not clear to me whether this is paginated, i.e., if only 40 descendants are returned.
