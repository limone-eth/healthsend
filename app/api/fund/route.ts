/**
 * Gas faucet for user-derived Arkiv keys.
 *
 * This is the one server-side thing in the app, and it exists only because
 * writing to Arkiv is a chain transaction and a freshly derived key has no GLM.
 * It moves gas; it never sees a document, a content key, or a link secret.
 *
 * The alternative — one shared app wallet signing every grant — would have been
 * less code and would have quietly broken the model: grants would be `ownedBy`
 * us instead of the sender, and the ownership filter behind the dashboard would
 * stop meaning anything. Keeping the key with the user and topping it up is the
 * honest version, and in production this becomes an on-ramp rather than a faucet.
 */

import { NextResponse } from "next/server"
import { createPublicClient, createWalletClient, http, isAddress, parseEther, type Hex } from "viem"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { privateKeyToAccount } from "viem/accounts"

/** Enough for a good number of grant writes, small enough to be harmless. */
const TOP_UP = parseEther("0.05")
/** Below this, top up. Above it, the key is fine and we do nothing. */
const FLOOR = parseEther("0.01")

export async function POST(request: Request) {
  const funderKey = process.env.ARKIV_FUNDER_PRIVATE_KEY as Hex | undefined
  if (!funderKey) {
    return NextResponse.json(
      { error: "ARKIV_FUNDER_PRIVATE_KEY is not set — see README, 'Funding the grant key'." },
      { status: 501 },
    )
  }

  let address: string
  try {
    ;({ address } = await request.json())
  } catch {
    return NextResponse.json({ error: "Expected JSON body { address }" }, { status: 400 })
  }
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 })
  }

  const rpc = process.env.NEXT_PUBLIC_ARKIV_RPC
  const publicClient = createPublicClient({ chain: tiramisu, transport: http(rpc) })

  const balance = await publicClient.getBalance({ address: address as Hex })
  if (balance >= FLOOR) {
    return NextResponse.json({ topUp: false, balance: balance.toString() })
  }

  const funder = createWalletClient({
    chain: tiramisu,
    transport: http(rpc),
    account: privateKeyToAccount(funderKey),
  })

  try {
    const txHash = await funder.sendTransaction({ to: address as Hex, value: TOP_UP })
    await publicClient.waitForTransactionReceipt({ hash: txHash })
    return NextResponse.json({ topUp: true, txHash })
  } catch (error) {
    // A dry faucet is the most likely failure at a hackathon, and it should read
    // as one rather than as a generic 500.
    return NextResponse.json(
      { error: `Funding failed (is the funder account out of GLM?): ${(error as Error).message}` },
      { status: 502 },
    )
  }
}
