import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import CrowdfundingABI from './Crowdfunding.json'
import RewardTokenABI from './RewardToken.json'
import './App.css'

const CROWDFUNDING_ADDRESS = "REPLACE_ON_DEPLOY"
const TOKEN_ADDRESS = "REPLACE_ON_DEPLOY"

function App() {
  const [account, setAccount] = useState("")
  const [provider, setProvider] = useState(null)
  const [contract, setContract] = useState(null)
  const [tokenContract, setTokenContract] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [userBalance, setUserBalance] = useState("0")
  const [ethBalance, setEthBalance] = useState("0.0")
  
  const [title, setTitle] = useState("")
  const [goal, setGoal] = useState("")
  const [duration, setDuration] = useState("")
  const [contributeAmount, setContributeAmount] = useState({})
  
  async function refreshBalances(provider, account, tokenContract) {
    const wei = await provider.getBalance(account)
    setEthBalance(ethers.formatEther(wei))
    
    const tokenWei = await tokenContract.balanceOf(account)
    setTokenBalance(ethers.formatUnits(tokenWei, 18))
  }

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum)
        const signer = await provider.getSigner()
        const address = await signer.getAddress()
        
        const crowdfunding = new ethers.Contract(CROWDFUNDING_ADDRESS, CrowdfundingABI.abi, signer)
        const token = new ethers.Contract(TOKEN_ADDRESS, RewardTokenABI.abi, signer)
        await refreshBalances(provider, address, token)

        setAccount(address)
        setProvider(provider)
        setContract(crowdfunding)
        setTokenContract(token)
      } catch (error) {
        console.error(error)
      }
    } else {
      alert("Please install MetaMask!")
    }
  }

  const fetchCampaigns = async () => {
    if (!contract) return
    try {
      const count = await contract.campaignCount()
      const loadedCampaigns = []
      for (let i = 0; i < count; i++) {
        const c = await contract.campaigns(i)
        loadedCampaigns.push({
          id: i,
          title: JSON.parse(localStorage.getItem("campaignTitles") ?? "{}")[c.titleHash] ?? `#{i}`,
          creator: c.creator,
          goal: ethers.formatEther(c.goalWei),
          raised: ethers.formatEther(c.totalRaised),
          deadline: new Date(Number(c.deadline) * 1000).toLocaleString(),
          finalized: (Number(c.flags) & 1) !== 0,
          successful: (Number(c.flags) & 2) !== 0
        })
      }
      setCampaigns(loadedCampaigns)
    } catch (error) {
      console.error("Error fetching campaigns:", error)
    }
  }

  const fetchBalance = async () => {
    if (!tokenContract || !account) return
    try {
      const balance = await tokenContract.balanceOf(account)
      setUserBalance(ethers.formatUnits(balance, 18))
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    if (contract) {
      fetchCampaigns()
      fetchBalance()
    }
  }, [contract, account])

  const createCampaign = async () => {
    if (!contract) return
  
    try {
      const goalWei = ethers.parseEther(goal)
      const tx = await contract.createCampaign(title, goalWei, duration)
      await tx.wait()
      await refreshBalances(provider, address, token)
  
      const count = await contract.campaignCount()
      const lastIndex = Number(count) - 1
      const created = await contract.campaigns(lastIndex)
  
      const titleHash = created.titleHash
  
      // store titleHash -> title (simple localStorage map)
      // NOTE (by Roman): it would be better to use actual db.
      // I do not store title on-chain because it adds overhead
      // to deployment, so we handle it off-chain.
      const key = "campaignTitles"
      const map = JSON.parse(localStorage.getItem(key) ?? "{}")
      map[titleHash] = title
      localStorage.setItem(key, JSON.stringify(map))
  
      alert("Campaign Created!")
      fetchCampaigns()
    } catch (error) {
      console.error(error)
      alert("Transaction failed")
    }
  }

  const contribute = async (id) => {
    if (!contract) return
    try {
      const amount = contributeAmount[id]
      if (!amount) return
      const tx = await contract.contribute(id, { value: ethers.parseEther(amount) })
      await tx.wait()
      await refreshBalances(provider, address, token)
      alert("Contribution successful! Rewards minted.")
      fetchCampaigns()
      fetchBalance()
    } catch (error) {
      console.error(error)
      alert("Contribution failed")
    }
  }

  const finalize = async (id) => {
    if (!contract) return
    try {
      const tx = await contract.finalize(id)
      await tx.wait()
      await refreshBalances(provider, address, token)
      alert("Campaign Finalized")
      fetchCampaigns()
    } catch (error) {
      console.error(error)
      alert("Finalize failed (Check deadline)")
    }
  }

  const withdraw = async (id) => {
    if (!contract) return
    try {
      const tx = await contract.withdraw(id)
      await tx.wait()
      await refreshBalances(provider, address, token)
      alert("Funds Withdrawn")
      fetchCampaigns()
    } catch (error) {
      console.error(error)
      alert("Withdraw failed")
    }
  }

  return (
    <div className="container">
      <header>
        <h1>Blockchain Crowdfunding</h1>
        {!account ? (
          <button onClick={connectWallet} className="connect-btn">Connect MetaMask</button>
        ) : (
          <div className="wallet-info">
            <p>Wallet: {account.substring(0, 6)}...{account.substring(38)}</p>
            <p>ETH: {Number(ethBalance).toFixed(4)}</p>
            <p>Reward Token Balance: {parseFloat(userBalance).toFixed(2)} CRWD</p>
          </div>
        )}
      </header>

      {account && (
        <main>
          <section className="create-section">
            <h2>Create New Campaign</h2>
            <div className="form-group">
              <input placeholder="Campaign Title" onChange={(e) => setTitle(e.target.value)} />
              <input placeholder="Goal (ETH)" type="number" onChange={(e) => setGoal(e.target.value)} />
              <input placeholder="Duration (seconds)" type="number" onChange={(e) => setDuration(e.target.value)} />
              <button onClick={createCampaign}>Launch Campaign</button>
            </div>
          </section>

          <section className="list-section">
            <h2>Active Campaigns</h2>
            <div className="campaign-grid">
              {campaigns.map((c) => (
                <div key={c.id} className="card">
                  <h3>Campaign {c.title}</h3>
                  <p><strong>Creator:</strong> {c.creator.substring(0, 6)}...</p>
                  <p><strong>Goal:</strong> {c.goal} ETH</p>
                  <p><strong>Raised:</strong> {c.raised} ETH</p>
                  <p><strong>Deadline:</strong> {c.deadline}</p>
                  <p><strong>Status:</strong> {c.finalized ? (c.successful ? "Success" : "Failed") : "Active"}</p>
                  
                  {!c.finalized ? (
                    <div className="action-area">
                      <input 
                        placeholder="ETH" 
                        type="number" 
                        onChange={(e) => setContributeAmount({...contributeAmount, [c.id]: e.target.value})}
                      />
                      <button onClick={() => contribute(c.id)}>Contribute</button>
                      <button className="secondary-btn" onClick={() => finalize(c.id)}>Finalize (End)</button>
                    </div>
                  ) : (
                    c.successful && c.creator.toLowerCase() === account.toLowerCase() && (
                      <button onClick={() => withdraw(c.id)}>Withdraw Funds</button>
                    )
                  )}
                </div>
              ))}
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

export default App
