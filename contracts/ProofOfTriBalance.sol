// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Proof of TriBalance NFT
/// @notice mint(choice) где choice: 0=MetaMask, 1=Farcaster, 2=Monad
contract ProofOfTriBalance is ERC721URIStorage, Ownable {
    uint256 public nextTokenId = 1;
    mapping(address => bool) private _minted;
    mapping(uint8 => string) public tokenUriByChoice;

    event Minted(address indexed to, uint256 indexed tokenId, uint8 choice);

    constructor(
        string memory uriForMetaMask,
        string memory uriForFarcaster,
        string memory uriForMonad
    ) ERC721("Proof of TriBalance", "TRIBAL") Ownable(msg.sender) {
        tokenUriByChoice[0] = uriForMetaMask; // MetaMask
        tokenUriByChoice[1] = uriForFarcaster; // Farcaster
        tokenUriByChoice[2] = uriForMonad;     // Monad
    }

    function mint(uint8 choice) external {
        require(choice <= 2, "Invalid choice");
        require(!_minted[msg.sender], "Already minted");
        uint256 tokenId = nextTokenId++;
        _minted[msg.sender] = true;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, tokenUriByChoice[choice]);
        emit Minted(msg.sender, tokenId, choice);
    }

    function hasMinted(address user) external view returns (bool) {
        return _minted[user];
    }

    function setTokenURIByChoice(uint8 choice, string calldata newUri) external onlyOwner {
        require(choice <= 2, "Invalid choice");
        tokenUriByChoice[choice] = newUri;
    }
}
